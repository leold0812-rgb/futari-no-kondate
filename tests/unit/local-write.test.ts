import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLocalWrite, consumeLocalWrite, markLocalWrite } from "@/lib/realtime/local-write";

describe("自分の保存操作の印", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearLocalWrite();
  });

  it("印が無ければ読み直しを省かない", () => {
    expect(consumeLocalWrite()).toBe(false);
  });

  it("印は通知1回ぶんだけ有効（2回目の通知では読み直す）", () => {
    markLocalWrite();
    expect(consumeLocalWrite()).toBe(true);
    expect(consumeLocalWrite()).toBe(false);
  });

  it("数秒で切れる（相手の変更を取りこぼさない）", () => {
    vi.useFakeTimers();
    markLocalWrite(3000);
    vi.advanceTimersByTime(3001);
    expect(consumeLocalWrite()).toBe(false);
  });

  it("保存に失敗したら印を消せる", () => {
    markLocalWrite();
    clearLocalWrite();
    expect(consumeLocalWrite()).toBe(false);
  });
});
