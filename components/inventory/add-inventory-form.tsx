"use client";

import { useActionState, useRef, startTransition, type FormEvent } from "react";
import type { InventoryFormState } from "@/app/(main)/inventory/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import styles from "./inventory.module.css";

type Props = {
  action: (state: InventoryFormState, formData: FormData) => Promise<InventoryFormState>;
  ingredientNames: string[];
  today: string;
};

/** 在庫の手入力。材料名は既存の材料から候補を出し、分量は「300g」「2個」のように1欄で入力する */
export function AddInventoryForm({ action, ingredientNames, today }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      formAction(formData);
    });
    // 成功しても失敗しても入力は残さない（失敗時は理由を表示する。材料名は候補からすぐ選び直せる）
    form.querySelector<HTMLInputElement>('input[name="amount"]')!.value = "";
  }

  return (
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
  );
}
