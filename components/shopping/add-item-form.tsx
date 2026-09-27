"use client";

import { useActionState, useEffect, useRef, startTransition, type FormEvent } from "react";
import type { AddItemState } from "@/app/(main)/shopping/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import styles from "./shopping.module.css";

/** 献立以外の買う物を足す（品名・分量1欄）。成功したときだけ入力を空にする */
export function AddItemForm({ action }: { action: (state: AddItemState, formData: FormData) => Promise<AddItemState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }
  return (
    <form ref={formRef} onSubmit={handleSubmit} className={styles.section}>
      <div className={styles.addForm}>
        <label className={styles.field}>
          <span>品名</span>
          <input name="name" required maxLength={60} autoComplete="off" className={controlClassName} />
        </label>
        <label className={styles.field}>
          <span>分量（任意）</span>
          <input name="amount" placeholder="例：1袋" autoComplete="off" className={controlClassName} />
        </label>
        <Button type="submit" size="small" disabled={pending}>
          追加
        </Button>
      </div>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">{state.ok}</Alert> : null}
    </form>
  );
}
