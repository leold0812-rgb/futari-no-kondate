/**
 * 自分の保存操作の印（ブラウザ内だけ）。
 * 保存のserver actionは完了時に画面を読み直すため、その変更がRealtimeで戻ってきたときにもう一度読み直すと二重になる。
 * 操作の直前に印を付け、次のRealtimeの通知1回ぶんだけ読み直しを省く。印は数秒で切れる（相手の変更を取りこぼさないため）。
 */
let expiresAt = 0;

export function markLocalWrite(milliseconds = 3000): void {
  expiresAt = Date.now() + milliseconds;
}

export function clearLocalWrite(): void {
  expiresAt = 0;
}

/** 有効な印があれば消費してtrue */
export function consumeLocalWrite(): boolean {
  if (Date.now() >= expiresAt) return false;
  expiresAt = 0;
  return true;
}
