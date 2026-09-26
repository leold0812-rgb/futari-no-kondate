"use client";

import { useActionState, useRef, useState, startTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import { loginAction, type LoginFormState } from "./actions";
import styles from "./login.module.css";

export type LoginMember = { id: string; displayName: string };

export function LoginForm({ members, next }: { members: LoginMember[]; next: string }) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(loginAction, {});
  const [selected, setSelected] = useState<string>(state.userId ?? "");
  const pinRef = useRef<HTMLInputElement>(null);
  const selectedMember = members.find((m) => m.id === selected);

  // React 19はformのaction完了後にネイティブのform.reset()を行い、選んだ名前（radio）まで外れてしまう。
  // JSが有効なときは送信を自分で扱い、自動リセットを避ける（PINだけを空に戻す）。JS無効時はactionで送信される。
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (pinRef.current) pinRef.current.value = "";
    startTransition(() => formAction(formData));
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <fieldset className={styles.members}>
        <legend className={styles.legend}>使う人を選んでください</legend>
        {members.map((member) => (
          <label key={member.id} className={styles.member}>
            <input
              type="radio"
              name="userId"
              value={member.id}
              required
              checked={selected === member.id}
              onChange={() => setSelected(member.id)}
              className={styles.radio}
            />
            <span className={styles.memberName}>{member.displayName}</span>
          </label>
        ))}
      </fieldset>

      {selectedMember ? (
        <div className={styles.pinField}>
          {/* パスワード管理機能がPINを名前ごとに区別できるよう、表示名をusernameとして渡す */}
          <input type="text" name="username" autoComplete="username" value={selectedMember.displayName} readOnly hidden />
          <label htmlFor="pin" className={styles.pinLabel}>
            {selectedMember.displayName}さんのPIN
          </label>
          <p id="pin-hint" className={styles.hint}>
            6〜12桁の数字
          </p>
          <input
            ref={pinRef}
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6,12}"
            minLength={6}
            maxLength={12}
            autoComplete="current-password"
            required
            aria-describedby={state.error ? "pin-hint login-error" : "pin-hint"}
            className={`${controlClassName} ${styles.pinInput}`}
          />
        </div>
      ) : null}

      {state.error ? (
        <div id="login-error">
          <Alert tone="error">{state.error}</Alert>
        </div>
      ) : null}

      <Button type="submit" size="large" block disabled={pending || !selectedMember}>
        {pending ? "確認しています…" : "ログイン"}
      </Button>
    </form>
  );
}
