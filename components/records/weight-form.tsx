"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import styles from "./records.module.css";

type State = { error?: string; ok?: string };

/** 自分の体重の記録。同じ日に入れ直すと上書きする */
export function WeightForm({ action, today }: { action: (s: State, f: FormData) => Promise<State>; today: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.row}>
        <label className={styles.label}>
          日付
          <input type="date" name="measuredOn" defaultValue={today} max={today} required className={controlClassName} />
        </label>
        <label className={styles.label}>
          体重（kg）
          <input name="weightKg" inputMode="decimal" placeholder="例：60.5" required autoComplete="off" className={controlClassName} />
        </label>
      </div>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">{state.ok}</Alert> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "記録しています…" : "記録する"}
      </Button>
    </form>
  );
}
