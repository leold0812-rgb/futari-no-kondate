"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** 計画を開いた直後に10候補を用意する（既にあればサーバー側で何もしない） */
export function AutoGenerate({ planId, action }: { planId: string; action: (planId: string) => Promise<{ error?: string }> }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    const result = await action(planId).catch(() => ({ error: "通信に失敗しました。" }));
    if (result.error) setError(result.error);
    else router.refresh();
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 画面を開いたときに1回だけ実行する
  }, []);

  if (error) {
    return (
      <Alert tone="error" title="候補を用意できませんでした">
        <p>{error}</p>
        <Button onClick={() => void run()}>もう一度試す</Button>
      </Alert>
    );
  }
  return (
    <p role="status" aria-live="polite">
      保存したレシピから10候補を選んでいます…
    </p>
  );
}
