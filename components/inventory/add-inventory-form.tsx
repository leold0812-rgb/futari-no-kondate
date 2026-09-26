"use client";

import { useActionState, useEffect, useRef, useState, startTransition, type FormEvent } from "react";
import type { InventoryFormState } from "@/app/(main)/inventory/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import styles from "./inventory.module.css";

type Props = {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  ingredientNames: string[];
  today: string;
  /** 最初に開いておくか（在庫が空のとき）。追加後の再描画で閉じないよう、開閉はこの部品が持つ */
  defaultOpen: boolean;
};

/** 在庫の手入力。材料名は既存の材料から候補を出し、分量は「300g」「2個」のように1欄で入力する */
export function AddInventoryForm({ action, ingredientNames, today, defaultOpen }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(defaultOpen);
  const formRef = useRef<HTMLFormElement>(null);

  // 保存できたときだけ入力を空にする（失敗時は入力を残して理由を示す）
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <details className={styles.details} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>在庫を手で追加する</summary>
    <form ref={formRef} onSubmit={handleSubmit} className={styles.addForm}>
      <div className={styles.addFields}>
        <label className={styles.field}>
          <span>材料名</span>
          <input name="name" list="ingredient-names" required maxLength={60} autoComplete="off" className={controlClassName} />
        </label>
        <label className={styles.field}>
          <span>分量</span>
          <input name="amount" required placeholder="例：300g、2個" autoComplete="off" className={controlClassName} />
        </label>
        <label className={styles.field}>
          <span>購入日</span>
          <input name="purchasedOn" type="date" defaultValue={today} max={today} required className={controlClassName} />
        </label>
      </div>
      <datalist id="ingredient-names">
        {ingredientNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">{state.ok}</Alert> : null}
      <Button type="submit" block disabled={pending}>
        {pending ? "追加しています…" : "在庫に追加"}
      </Button>
    </form>
    </details>
  );
}
