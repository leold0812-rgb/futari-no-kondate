"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";

type State = { error?: string; ok?: string };

/** 自分のご飯の量（g）。本人だけが変更できる */
export function RiceForm({ action, initialGrams }: { action: (s: State, f: FormData) => Promise<State>; initialGrams: number | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} style={{ display: "grid", gap: 8 }}>
      <label htmlFor="rice-grams" style={{ fontWeight: 700 }}>
        自分のご飯（g）
      </label>
      <input
        id="rice-grams"
        name="grams"
        inputMode="numeric"
        defaultValue={initialGrams ?? ""}
        placeholder="例：150"
        required
        className={controlClassName}
      />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">{state.ok}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        保存
      </Button>
    </form>
  );
}
