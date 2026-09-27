"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { ImportActionResult } from "@/app/(main)/recipes/import-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import { EMPTY_RECIPE, RecipeForm, type RecipeFormState, type RecipeFormValues } from "./recipe-form";
import styles from "./new-recipe-flow.module.css";

type Props = {
  initialUrl: string;
  importAction: (url: string) => Promise<ImportActionResult>;
  saveUrlOnlyAction: (url: string, title: string | null) => Promise<{ error: string }>;
  saveAction: (state: RecipeFormState, formData: FormData) => Promise<RecipeFormState>;
  submitLabel?: string;
  /** 「URLだけ保存」を出すか（再取り込みでは既に保存済みなので出さない） */
  allowUrlOnly?: boolean;
};

type Stage =
  | { kind: "url" }
  | { kind: "failed"; result: Extract<ImportActionResult, { ok: false }> }
  | { kind: "form"; values: RecipeFormValues; importedFrom: "JSON_LD" | "AI" | null; importImageUrl: string | null };

/**
 * レシピ追加の入口。URLからの取り込み（既定）と手入力を切り替える。
 * 取り込みに失敗しても行き止まりにせず、「URLだけ保存」と「手入力で続ける」を示す（UIガイドライン）。
 */
export function NewRecipeFlow({
  initialUrl,
  importAction,
  saveUrlOnlyAction,
  saveAction,
  submitLabel = "保存する",
  allowUrlOnly = true,
}: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "url" });
  const [url, setUrl] = useState(initialUrl);
  const [pending, startTransition] = useTransition();
  const [urlOnlyError, setUrlOnlyError] = useState<string | null>(null);

  function runImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUrlOnlyError(null);
    startTransition(async () => {
      let result: ImportActionResult;
      try {
        result = await importAction(url);
      } catch {
        // 通信断・サーバーエラーでも行き止まりにせず、URLだけ保存・手入力へ進めるようにする（URLは引き継ぐ）
        let host: string | null = null;
        try {
          const parsed = new URL(url.trim());
          host = parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.hostname : null;
        } catch {
          host = null;
        }
        result = {
          ok: false,
          method: "NONE",
          reason: "通信に失敗しました。通信状態を確認してもう一度取り込むか、手入力で続けてください。",
          title: null,
          sourceUrl: url.trim(),
          host,
        } as ImportActionResult;
      }
      if (!result.ok) {
        setStage({ kind: "failed", result });
        return;
      }
      const d = result.draft;
      setStage({
        kind: "form",
        importedFrom: result.method,
        importImageUrl: d.imageUrl,
        values: {
          ...EMPTY_RECIPE,
          name: d.name,
          servings: d.servings,
          cookingMinutes: d.cookingMinutes,
          sourceUrl: d.sourceUrl,
          ingredients: d.ingredients,
          instructions: d.instructions,
          nutrition: { ...EMPTY_RECIPE.nutrition, energyKcal: d.energyKcal },
        },
      });
    });
  }

  function saveUrlOnly(sourceUrl: string, title: string | null) {
    startTransition(async () => {
      try {
        const result = await saveUrlOnlyAction(sourceUrl, title);
        if (result?.error) setUrlOnlyError(result.error);
      } catch (error) {
        // 保存成功時はredirectで画面が切り替わる（Next.jsのredirectは例外として伝わるため再送出する）
        if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
        setUrlOnlyError("保存できませんでした。通信状態を確認して、もう一度お試しください。");
      }
    });
  }

  if (stage.kind === "form") {
    return (
      <div className={styles.stack}>
        {stage.importedFrom === "JSON_LD" ? (
          <Alert tone="success" title="ページのレシピ情報を読み取りました（まだ保存されていません）">
            <p>内容を確認して、必要なら直してから保存してください。</p>
          </Alert>
        ) : stage.importedFrom === "AI" ? (
          <Alert tone="info" title="AIで読み取りました（まだ保存されていません）">
            <p>分量や手順が元のページと合っているか確認してから保存してください。</p>
          </Alert>
        ) : null}
        <RecipeForm
          initial={stage.values}
          action={saveAction}
          submitLabel={submitLabel}
          importImageUrl={stage.importImageUrl}
        />
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <form onSubmit={runImport} className={styles.card}>
        <label htmlFor="import-url" className={styles.label}>
          レシピのページのURL
        </label>
        <p id="import-url-hint" className={styles.hint}>
          レシピサイトやInstagramの投稿のURLを貼り付けてください。読み取った内容は保存前に確認できます。
        </p>
        <input
          id="import-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          aria-describedby="import-url-hint"
          className={controlClassName}
        />
        <Button type="submit" size="large" block disabled={pending || !url.trim()}>
          {pending ? "ページを読み取っています…（最大40秒ほど）" : "取り込む"}
        </Button>
      </form>

      {stage.kind === "failed" ? (
        <Alert tone="error" title="レシピを読み取れませんでした（まだ保存されていません）">
          <p>{stage.result.reason}</p>
          <div className={styles.fallback}>
            {stage.result.host && allowUrlOnly ? (
              <Button
                variant="secondary"
                block
                disabled={pending}
                onClick={() => saveUrlOnly(stage.result.sourceUrl, stage.result.title)}
              >
                URLだけ保存する
              </Button>
            ) : null}
            <Button
              variant="secondary"
              block
              onClick={() =>
                setStage({
                  kind: "form",
                  importedFrom: null,
                  importImageUrl: null,
                  values: {
                    ...EMPTY_RECIPE,
                    name: stage.result.title?.slice(0, 80) ?? "",
                    sourceUrl: stage.result.host ? stage.result.sourceUrl : null,
                  },
                })
              }
            >
              手入力で続ける
            </Button>
          </div>
          {urlOnlyError ? <p className={styles.error}>{urlOnlyError}</p> : null}
        </Alert>
      ) : null}

      <div className={styles.divider} role="separator">
        または
      </div>
      <Button
        variant="secondary"
        block
        onClick={() => setStage({ kind: "form", importedFrom: null, importImageUrl: null, values: EMPTY_RECIPE })}
      >
        URLなしで手入力する
      </Button>
    </div>
  );
}
