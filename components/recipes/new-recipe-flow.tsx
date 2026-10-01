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
  /** 貼り付けた文章（Instagramのキャプションなど）から読み取る */
  importTextAction: (text: string) => Promise<ImportActionResult>;
  saveUrlOnlyAction: (url: string, title: string | null) => Promise<{ error: string }>;
  saveAction: (state: RecipeFormState, formData: FormData) => Promise<RecipeFormState>;
  submitLabel?: string;
  /** 「URLだけ保存」を出すか（再取り込みでは既に保存済みなので出さない） */
  allowUrlOnly?: boolean;
};

type Stage =
  | { kind: "url" }
  | { kind: "failed"; result: Extract<ImportActionResult, { ok: false }> }
  | { kind: "form"; values: RecipeFormValues; importedFrom: "JSON_LD" | "AI" | "TEXT" | null; importImageUrl: string | null };

/**
 * レシピ追加の入口。URLからの取り込み（既定）と手入力を切り替える。
 * 取り込みに失敗しても行き止まりにせず、「URLだけ保存」と「手入力で続ける」を示す（UIガイドライン）。
 */
export function NewRecipeFlow({
  initialUrl,
  importAction,
  importTextAction,
  saveUrlOnlyAction,
  saveAction,
  submitLabel = "保存する",
  allowUrlOnly = true,
}: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "url" });
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [textOpen, setTextOpen] = useState(false);
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
      showResult(result);
    });
  }

  function showResult(result: ImportActionResult, keepSourceUrl: string | null = null) {
    if (!result.ok) {
      setStage({ kind: "failed", result });
      // 文章にレシピが無い・取得できないときは、貼り付けの入口を開いておく
      setTextOpen(true);
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
        sourceUrl: d.sourceUrl || keepSourceUrl,
        ingredients: d.ingredients,
        instructions: d.instructions,
        nutrition: { ...EMPTY_RECIPE.nutrition, energyKcal: d.energyKcal },
      },
    });
  }

  function runTextImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUrlOnlyError(null);
    // URL欄に入っているURL（取り込めなかった投稿など）は、出典として引き継ぐ
    let sourceUrl: string | null = null;
    try {
      const parsed = new URL(url.trim());
      sourceUrl = parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
    } catch {
      sourceUrl = null;
    }
    startTransition(async () => {
      let result: ImportActionResult;
      try {
        result = await importTextAction(text);
      } catch {
        result = {
          ok: false,
          method: "NONE",
          reason: "通信に失敗しました。通信状態を確認してもう一度試すか、手入力で続けてください。",
          title: null,
          sourceUrl: "",
          host: null,
        } as ImportActionResult;
      }
      showResult(result, sourceUrl);
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
        ) : stage.importedFrom === "TEXT" ? (
          <Alert tone="success" title="文章からレシピを読み取りました（まだ保存されていません）">
            <p>材料と分量、作り方が合っているか確認して、必要なら直してから保存してください。</p>
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

      <details className={styles.card} open={textOpen} onToggle={(e) => setTextOpen(e.currentTarget.open)}>
        <summary className={styles.label}>投稿の文章を貼り付けて取り込む</summary>
        <form onSubmit={runTextImport} className={styles.textForm}>
          <label htmlFor="import-text" className={styles.hint}>
            Instagramの投稿の文章（キャプション）や、メモのレシピをそのまま貼り付けてください。「材料」と「作り方」の見出しから読み取ります。
          </label>
          <textarea
            id="import-text"
            className={controlClassName}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            maxLength={8000}
            placeholder={"例：\n鶏の照り焼き\n【材料】2人分\n鶏もも肉 300g\n醤油 大さじ2\n【作り方】\n1. 鶏肉を焼く"}
          />
          <Button type="submit" variant="secondary" block disabled={pending || text.trim().length < 10}>
            {pending ? "読み取っています…" : "文章から取り込む"}
          </Button>
        </form>
      </details>

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
