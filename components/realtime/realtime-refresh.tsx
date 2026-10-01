"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { consumeLocalWrite } from "@/lib/realtime/local-write";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * 共有データの変更を2人の画面へ届ける（Supabase Realtime、RLSで購読者を制限）。
 * 変更を受けたら画面を読み直すだけで、整合性はDB側の処理で保証する（architecture.md）。
 */
export function RealtimeRefresh({ tables, coupleSpaceId }: { tables: string[]; coupleSpaceId: string }) {
  const router = useRouter();
  const key = tables.join(",");

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return; // 環境変数が無い（ローカルの設定不足）場合は同期しない
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // 自分の保存の直後に届いた通知は、保存の完了時にすでに読み直しているので省く
        if (consumeLocalWrite()) return;
        router.refresh();
      }, 300);
    };
    const channel = supabase.channel(`space-${coupleSpaceId}-${key}`);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `couple_space_id=eq.${coupleSpaceId}` }, refresh);
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [key, coupleSpaceId, router]);

  return null;
}
