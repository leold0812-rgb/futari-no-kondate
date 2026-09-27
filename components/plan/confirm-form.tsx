"use client";

import { useActionState } from "react";
import type { ConfirmState } from "@/app/(main)/plan/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  action: (state: ConfirmState, formData: FormData) => Promise<ConfirmState>;
  version: number;
  disabled: boolean;
  count: number;
};

/** 確定。二重送信を防ぐため送信中はボタンを無効にし、サーバー側も冪等（同じ内容の再送は成功扱い） */
export function ConfirmForm({ action, version, disabled, count }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="version" value={version} />
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      <Button type="submit" size="large" block disabled={disabled || pending}>
        {pending ? "決めています…" : `この${count}品で決める`}
      </Button>
    </form>
  );
}
