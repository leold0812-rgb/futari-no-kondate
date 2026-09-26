"use client";

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import { loginAction, type LoginFormState } from "./actions";
import styles from "./login.module.css";

export type LoginMember = { id: string; displayName: string };

export function LoginForm({ members, next }: { members: LoginMember[]; next: string }) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(loginAction, {});
  const [selected, setSelected] = useState<string>(state.userId ?? "");
  const selectedMember = members.find((m) => m.id === (selected || state.userId));

  return (
    <form action={formAction} className={styles.form}>
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
              checked={(selected || state.userId) === member.id}
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
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6,12}"
            minLength={6}
            maxLength={12}
            autoComplete="current-password"
            required
            aria-describedby="pin-hint"
            className={`${controlClassName} ${styles.pinInput}`}
            // 失敗後の再表示で入力を残さない
            key={state.error ?? "initial"}
          />
        </div>
      ) : null}

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Button type="submit" size="large" block disabled={pending || !selectedMember}>
        {pending ? "確認しています…" : "ログイン"}
      </Button>
    </form>
  );
}
