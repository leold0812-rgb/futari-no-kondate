"use client";

import { useActionState, useEffect, useId, useRef, useState, startTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import {
  CUISINE_LABELS,
  CUISINES,
  DISH_TYPE_LABELS,
  DISH_TYPES,
  KNOWN_TAGS,
  MAIN_CATEGORIES,
  MAIN_CATEGORY_LABELS,
  type Cuisine,
  type DishType,
  type MainCategory,
} from "@/lib/recipes/constants";
import { splitIngredientLine } from "@/lib/ingredients";
import { parseAmount } from "@/lib/units";
import { canonicalUnit, quantityChoices, quantityForUnit, quantityLabel, quantityMode, unitLabel, unitOptions } from "@/lib/units/amount-choices";
import styles from "./recipe-form.module.css";

export type RecipeFormState = { errors?: string[] };

export type RecipeFormValues = {
  name: string;
  dishType: DishType;
  mainCategory: MainCategory | null;
  cuisine: Cuisine | null;
  servings: number;
  cookingMinutes: number | null;
  sourceUrl: string | null;
  ingredients: { rawName: string; quantity: number | null; unit: string | null; note: string | null; isMain: boolean }[];
  instructions: string[];
  highCost: boolean;
  specialSeasoning: boolean;
  oneDish: boolean;
  tags: string[];
  memo: string | null;
  nutrition: { energyKcal: number | null; proteinG: number | null; fatG: number | null; carbsG: number | null };
  imageUrl?: string | null;
};

export const EMPTY_RECIPE: RecipeFormValues = {
  name: "",
  dishType: "MAIN",
  mainCategory: null,
  cuisine: null,
  servings: 2,
  cookingMinutes: null,
  sourceUrl: null,
  ingredients: [],
  instructions: [],
  highCost: false,
  specialSeasoning: false,
  oneDish: false,
  tags: [],
  memo: null,
  nutrition: { energyKcal: null, proteinG: null, fatG: null, carbsG: null },
};

/** quantity は数字の文字列（数量なしは空）、unit は単位（未選択は空） */
type IngredientRow = { key: number; rawName: string; quantity: string; unit: string; note: string; isMain: boolean };

/** 保存済み・取り込み・貼り付けの値を、選択欄の値へそろえる */
function amountFields(quantity: number | null, unit: string | null): Pick<IngredientRow, "quantity" | "unit"> {
  const canonical = canonicalUnit(unit);
  // 「卵 2」のように数だけの場合は「個」として扱う
  const resolved = quantity !== null && canonical === "" ? "個" : canonical;
  return { quantity: quantity === null || quantityMode(resolved) === "none" ? "" : String(quantity), unit: resolved };
}

const MAX_IMAGE_EDGE = 1600;

// 材料行のReact key（表示中だけ一意であればよい）
let rowKeySequence = 0;
const newKey = () => (rowKeySequence += 1);

/** iPhoneの写真（数MB）をそのまま送らないよう、長辺1600pxのJPEGへ縮小する */
async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("resize failed"))), "image/jpeg", 0.85),
  );
}

function toNumberOrNull(value: string): number | null {
  const trimmed = value.normalize("NFKC").trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

type Props = {
  initial: RecipeFormValues;
  action: (state: RecipeFormState, formData: FormData) => Promise<RecipeFormState>;
  submitLabel: string;
  /** URL取り込みで見つかった元ページの写真。利用者が確認した場合だけサーバーが複製する */
  importImageUrl?: string | null;
};

export function RecipeForm({ initial, action, submitLabel, importImageUrl = null }: Props) {
  const idPrefix = useId();

  const [state, formAction, pending] = useActionState<RecipeFormState, FormData>(action, {});
  const [name, setName] = useState(initial.name);
  const [dishType, setDishType] = useState<DishType>(initial.dishType);
  const [mainCategory, setMainCategory] = useState<string>(initial.mainCategory ?? "");
  const [cuisine, setCuisine] = useState<string>(initial.cuisine ?? "");
  const [servings, setServings] = useState(String(initial.servings));
  const [cookingMinutes, setCookingMinutes] = useState(initial.cookingMinutes ? String(initial.cookingMinutes) : "");
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl ?? "");
  const [rows, setRows] = useState<IngredientRow[]>(() =>
    (initial.ingredients.length > 0 ? initial.ingredients : [{ rawName: "", quantity: 1, unit: "個", note: null, isMain: false }]).map(
      (line) => ({
        key: newKey(),
        rawName: line.rawName,
        ...amountFields(line.quantity, line.unit),
        note: line.note ?? "",
        isMain: line.isMain,
      }),
    ),
  );
  const [paste, setPaste] = useState("");
  const [steps, setSteps] = useState(initial.instructions.join("\n"));
  const [highCost, setHighCost] = useState(initial.highCost);
  const [specialSeasoning, setSpecialSeasoning] = useState(initial.specialSeasoning);
  const [oneDish, setOneDish] = useState(initial.oneDish);
  const [tags, setTags] = useState<string[]>(initial.tags.filter((t) => (KNOWN_TAGS as readonly string[]).includes(t)));
  const [extraTags, setExtraTags] = useState(initial.tags.filter((t) => !(KNOWN_TAGS as readonly string[]).includes(t)).join("、"));
  const [memo, setMemo] = useState(initial.memo ?? "");
  const [nutrition, setNutrition] = useState({
    energyKcal: initial.nutrition.energyKcal?.toString() ?? "",
    proteinG: initial.nutrition.proteinG?.toString() ?? "",
    fatG: initial.nutrition.fatG?.toString() ?? "",
    carbsG: initial.nutrition.carbsG?.toString() ?? "",
  });
  const [image, setImage] = useState<Blob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(initial.imageUrl ?? null);
  const [removeImage, setRemoveImage] = useState(false);
  const [copySourceImage, setCopySourceImage] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.errors?.length || clientError) errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [state, clientError]);

  useEffect(() => {
    return () => {
      if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  function updateRow(key: number, patch: Partial<IngredientRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, { key: newKey(), rawName: "", quantity: "1", unit: "個", note: "", isMain: false }]);
  }

  function importPaste() {
    const lines = paste.split(/\r?\n/).map(splitIngredientLine).filter((l): l is { rawName: string; amount: string } => l !== null);
    if (lines.length === 0) return;
    setRows((current) => [
      ...current.filter((row) => row.rawName.trim() !== ""),
      ...lines.map((line) => {
        const parsed = parseAmount(line.amount);
        return { key: newKey(), rawName: line.rawName, ...amountFields(parsed.quantity, parsed.unit), note: "", isMain: false };
      }),
    ]);
    setPaste("");
  }

  async function onImageChange(file: File | undefined) {
    setClientError(null);
    if (!file) return;
    try {
      const resized = await resizeImage(file);
      setImage(resized);
      setRemoveImage(false);
      setImagePreview(URL.createObjectURL(resized));
    } catch {
      setClientError("写真を読み込めませんでした。別の写真を選んでください（JPEG・PNG・WebP）。");
    }
  }

  function buildPayload() {
    const numbers = {
      servings: toNumberOrNull(servings),
      cookingMinutes: toNumberOrNull(cookingMinutes),
      energyKcal: toNumberOrNull(nutrition.energyKcal),
      proteinG: toNumberOrNull(nutrition.proteinG),
      fatG: toNumberOrNull(nutrition.fatG),
      carbsG: toNumberOrNull(nutrition.carbsG),
    };
    if (Object.values(numbers).some((n) => Number.isNaN(n))) {
      return { error: "数字の欄（人数・調理時間・栄養）には数字だけを入力してください。" } as const;
    }
    const filled = rows.filter((row) => row.rawName.trim() !== "");
    for (const row of filled) {
      if (quantityMode(row.unit) === "none") continue;
      const value = toNumberOrNull(row.quantity);
      if (value !== null && (Number.isNaN(value) || value <= 0)) {
        return { error: `「${row.rawName.trim()}」の数量には0より大きい数字を入力してください。` } as const;
      }
    }
    const ingredients = filled.map((row) => ({
      rawName: row.rawName.trim(),
      quantity: quantityMode(row.unit) === "none" ? null : toNumberOrNull(row.quantity),
      unit: row.unit || null,
      note: row.note.trim() || null,
      isMain: row.isMain,
    }));
    const extra = extraTags
      .split(/[、,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return {
      payload: {
        name,
        dishType,
        mainCategory: mainCategory || null,
        cuisine: cuisine || null,
        servings: numbers.servings ?? 2,
        cookingMinutes: numbers.cookingMinutes,
        sourceUrl: sourceUrl.trim() || null,
        instructions: steps
          .split(/\r?\n/)
          .map((s) => s.replace(/^\s*(\d+[.．)）]|[①-⑳])\s*/, "").trim())
          .filter(Boolean),
        ingredients,
        highCost,
        specialSeasoning,
        oneDish,
        tags: [...new Set([...tags, ...extra])],
        memo: memo.trim() || null,
        nutrition: {
          energyKcal: numbers.energyKcal,
          proteinG: numbers.proteinG,
          fatG: numbers.fatG,
          carbsG: numbers.carbsG,
        },
      },
    } as const;
  }

  // React 19の自動form resetで入力欄の表示とstateがずれないよう、送信は自分で扱う
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setClientError(null);
    const built = buildPayload();
    if ("error" in built) {
      setClientError(built.error ?? null);
      return;
    }
    const formData = new FormData();
    formData.set("payload", JSON.stringify(built.payload));
    if (image) formData.set("image", image, "photo.jpg");
    if (removeImage) formData.set("removeImage", "1");
    if (!image && copySourceImage && importImageUrl) formData.set("importImageUrl", importImageUrl);
    startTransition(() => formAction(formData));
  }

  const f = (name: string) => `${idPrefix}-${name}`;
  const errors = clientError ? [clientError] : (state.errors ?? []);

  return (
    <form onSubmit={handleSubmit} className={styles.form} noValidate>
      <div ref={errorRef}>
        {errors.length > 0 ? (
          <Alert tone="error" title="保存できませんでした（まだ保存されていません）">
            <ul className={styles.errorList}>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>

      <section className={styles.section} aria-labelledby={f("basic")}>
        <h2 id={f("basic")} className={styles.sectionTitle}>
          基本
        </h2>
        <div className={styles.field}>
          <label htmlFor={f("name")} className={styles.label}>
            料理名（必須）
          </label>
          <input
            id={f("name")}
            className={controlClassName}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoComplete="off"
          />
        </div>

        <fieldset className={styles.segmentGroup}>
          <legend className={styles.label}>種類</legend>
          <div className={styles.segments}>
            {DISH_TYPES.map((type) => (
              <label key={type} className={styles.segment}>
                <input
                  type="radio"
                  name={f("dishType")}
                  checked={dishType === type}
                  onChange={() => setDishType(type)}
                  className={styles.segmentInput}
                />
                <span>{DISH_TYPE_LABELS[type]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.twoColumns}>
          <div className={styles.field}>
            <label htmlFor={f("category")} className={styles.label}>
              大分類
            </label>
            <select
              id={f("category")}
              className={controlClassName}
              value={mainCategory}
              onChange={(e) => setMainCategory(e.target.value)}
            >
              <option value="">未設定</option>
              {MAIN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MAIN_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor={f("cuisine")} className={styles.label}>
              ジャンル
            </label>
            <select id={f("cuisine")} className={controlClassName} value={cuisine} onChange={(e) => setCuisine(e.target.value)}>
              <option value="">未設定</option>
              {CUISINES.map((c) => (
                <option key={c} value={c}>
                  {CUISINE_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor={f("servings")} className={styles.label}>
              何人分のレシピか
            </label>
            <select id={f("servings")} className={controlClassName} value={servings} onChange={(e) => setServings(e.target.value)}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}人分
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor={f("minutes")} className={styles.label}>
              調理時間（分）
            </label>
            <input
              id={f("minutes")}
              className={controlClassName}
              inputMode="numeric"
              value={cookingMinutes}
              onChange={(e) => setCookingMinutes(e.target.value)}
              placeholder="例：20"
            />
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby={f("ingredients")}>
        <h2 id={f("ingredients")} className={styles.sectionTitle}>
          材料
        </h2>
        <p className={styles.hint}>単位を選ぶと、数量を選ぶか入力できます。「少々・適量」は数量なしです。</p>
        <ol className={styles.rows}>
          {rows.map((row, index) => (
            <li key={row.key} className={styles.row}>
              <div className={styles.rowFields}>
                <label className={styles.srOnly} htmlFor={f(`ing-${row.key}`)}>
                  {index + 1}行目の材料名
                </label>
                <input
                  id={f(`ing-${row.key}`)}
                  className={controlClassName}
                  value={row.rawName}
                  onChange={(e) => updateRow(row.key, { rawName: e.target.value })}
                  placeholder="材料名"
                  maxLength={60}
                  autoComplete="off"
                />
              </div>
              <div className={styles.amountFields}>
                <label className={styles.srOnly} htmlFor={f(`qty-${row.key}`)}>
                  {index + 1}行目の数量
                </label>
                {quantityMode(row.unit) === "choice" ? (
                  <select
                    id={f(`qty-${row.key}`)}
                    className={controlClassName}
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                  >
                    {quantityChoices(row.unit, row.quantity === "" ? null : Number(row.quantity)).map((value) => (
                      <option key={value} value={String(value)}>
                        {quantityLabel(value)}
                      </option>
                    ))}
                  </select>
                ) : quantityMode(row.unit) === "number" ? (
                  <input
                    id={f(`qty-${row.key}`)}
                    className={controlClassName}
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    inputMode="decimal"
                    placeholder="数量"
                    autoComplete="off"
                  />
                ) : (
                  <input id={f(`qty-${row.key}`)} className={controlClassName} value="" placeholder="—" disabled readOnly />
                )}
                <label className={styles.srOnly} htmlFor={f(`unit-${row.key}`)}>
                  {index + 1}行目の単位
                </label>
                <select
                  id={f(`unit-${row.key}`)}
                  className={controlClassName}
                  value={row.unit}
                  onChange={(e) => updateRow(row.key, { unit: e.target.value, quantity: quantityForUnit(e.target.value, row.quantity) })}
                >
                  {row.unit === "" ? <option value="">単位を選ぶ</option> : null}
                  <optgroup label="よく使う">
                    {unitOptions(row.unit).primary.map((unit) => (
                      <option key={unit} value={unit}>
                        {unitLabel(unit)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="数量なし">
                    {unitOptions(row.unit).none.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="そのほか">
                    {unitOptions(row.unit).other.map((unit) => (
                      <option key={unit} value={unit}>
                        {unitLabel(unit)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className={styles.rowActions}>
                <label className={styles.checkbox}>
                  <input type="checkbox" checked={row.isMain} onChange={(e) => updateRow(row.key, { isMain: e.target.checked })} />
                  主な材料
                </label>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                  aria-label={`${index + 1}行目の材料「${row.rawName || "未入力"}」を削除`}
                >
                  削除
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <Button variant="secondary" onClick={addRow}>
          ＋ 材料を追加
        </Button>
        <details className={styles.details}>
          <summary>材料をまとめて貼り付ける</summary>
          <div className={styles.field}>
            <label htmlFor={f("paste")} className={styles.label}>
              1行に1つ（例：鶏もも肉 300g）
            </label>
            <textarea id={f("paste")} className={controlClassName} value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} />
            <Button variant="secondary" onClick={importPaste} disabled={!paste.trim()}>
              材料欄に取り込む
            </Button>
          </div>
        </details>
      </section>

      <section className={styles.section} aria-labelledby={f("steps")}>
        <h2 id={f("steps")} className={styles.sectionTitle}>
          作り方
        </h2>
        <div className={styles.field}>
          <label htmlFor={f("stepsInput")} className={styles.label}>
            手順（1行に1つ）
          </label>
          <p id={f("stepsHint")} className={styles.hint}>
            先頭の番号は自動で取り除きます。調理モードでは1行ずつ大きく表示します。
          </p>
          <textarea
            id={f("stepsInput")}
            aria-describedby={f("stepsHint")}
            className={controlClassName}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            rows={8}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby={f("photo")}>
        <h2 id={f("photo")} className={styles.sectionTitle}>
          写真
        </h2>
        {imagePreview && !removeImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- 端末内のプレビュー（blob URL）と期限付きURL
          <img src={imagePreview} alt="選んだ写真のプレビュー" className={styles.preview} />
        ) : null}
        <div className={styles.field}>
          <label htmlFor={f("image")} className={styles.label}>
            {imagePreview && !removeImage ? "写真を変更" : "写真を選ぶ（任意）"}
          </label>
          <input
            id={f("image")}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => onImageChange(e.target.files?.[0])}
            className={styles.file}
          />
        </div>
        {importImageUrl && !image ? (
          <label className={styles.checkbox}>
            <input type="checkbox" checked={copySourceImage} onChange={(e) => setCopySourceImage(e.target.checked)} />
            元のページの写真も保存する（サイトの利用条件で許可されている場合だけ）
          </label>
        ) : null}
        {imagePreview && !removeImage ? (
          <Button variant="ghost" size="small" onClick={() => { setRemoveImage(true); setImage(null); }}>
            写真を外す
          </Button>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby={f("more")}>
        <h2 id={f("more")} className={styles.sectionTitle}>
          献立づくりの参考
        </h2>
        <fieldset className={styles.checkboxGroup}>
          <legend className={styles.label}>タグ</legend>
          {KNOWN_TAGS.map((tag) => (
            <label key={tag} className={styles.checkbox}>
              <input
                type="checkbox"
                checked={tags.includes(tag)}
                onChange={(e) => setTags((current) => (e.target.checked ? [...current, tag] : current.filter((t) => t !== tag)))}
              />
              {tag}
            </label>
          ))}
        </fieldset>
        <div className={styles.field}>
          <label htmlFor={f("extraTags")} className={styles.label}>
            その他のタグ（、区切り）
          </label>
          <input id={f("extraTags")} className={controlClassName} value={extraTags} onChange={(e) => setExtraTags(e.target.value)} />
        </div>
        <fieldset className={styles.checkboxGroup}>
          <legend className={styles.label}>特徴</legend>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={highCost} onChange={(e) => setHighCost(e.target.checked)} />
            材料費が高め
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={specialSeasoning} onChange={(e) => setSpecialSeasoning(e.target.checked)} />
            ふだん無い調味料が必要
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={oneDish} onChange={(e) => setOneDish(e.target.checked)} />
            一品で完結（副菜・汁物なしでもよい）
          </label>
        </fieldset>
        <div className={styles.field}>
          <label htmlFor={f("url")} className={styles.label}>
            元のページのURL
          </label>
          <input
            id={f("url")}
            type="url"
            inputMode="url"
            className={controlClassName}
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://"
          />
        </div>
        <details className={styles.details}>
          <summary>栄養（1人前・わかる場合だけ）</summary>
          <p className={styles.hint}>分からない欄は空のままにしてください（推測の値は入れません）。</p>
          <div className={styles.twoColumns}>
            {(
              [
                ["energyKcal", "エネルギー（kcal）"],
                ["proteinG", "たんぱく質（g）"],
                ["fatG", "脂質（g）"],
                ["carbsG", "炭水化物（g）"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className={styles.field}>
                <label htmlFor={f(key)} className={styles.label}>
                  {label}
                </label>
                <input
                  id={f(key)}
                  className={controlClassName}
                  inputMode="decimal"
                  value={nutrition[key]}
                  onChange={(e) => setNutrition((current) => ({ ...current, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </details>
        <div className={styles.field}>
          <label htmlFor={f("memo")} className={styles.label}>
            メモ
          </label>
          <textarea id={f("memo")} className={controlClassName} value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} />
        </div>
      </section>

      <div className={styles.submitBar}>
        <Button type="submit" size="large" block disabled={pending}>
          {pending ? "保存しています…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
