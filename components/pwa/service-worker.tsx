"use client";

import { useEffect } from "react";

/** オフライン案内用のService Workerを登録する（本番buildだけ。開発中の古いキャッシュを避けるため） */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // 登録できなくてもアプリは使える（オフライン案内が出ないだけ）
    });
  }, []);
  return null;
}
