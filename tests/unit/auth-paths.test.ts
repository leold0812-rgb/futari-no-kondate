import { describe, expect, it } from "vitest";
import { AUTO_LOGIN_TRIED_COOKIE, isPublicPath, safeNextPath } from "@/lib/auth/paths";

describe("isPublicPath", () => {
  it("session発行の入口とオフライン画面だけが、sessionなしで開ける", () => {
    expect(isPublicPath("/api/auth/start")).toBe(true);
    expect(isPublicPath("/offline")).toBe(true);
  });

  it("それ以外の画面は開けない（proxyがsession発行へ寄せる）", () => {
    for (const path of ["/", "/records", "/settings", "/recipes/abc", "/api/cron/backup"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe("safeNextPath", () => {
  it("同じサイトの中のpathはそのまま戻り先にする", () => {
    expect(safeNextPath("/records")).toBe("/records");
    expect(safeNextPath("/recipes?sort=new")).toBe("/recipes?sort=new");
  });

  it("外のサイトへ飛ばす値は受け付けず、トップへ戻す", () => {
    for (const value of [
      "//evil.example.com",
      "/\\evil.example.com",
      "https://evil.example.com",
      "http://evil.example.com",
      "javascript:alert(1)",
      "evil.example.com",
      "",
    ]) {
      expect(safeNextPath(value)).toBe("/");
    }
  });

  it("文字列以外もトップへ戻す", () => {
    for (const value of [null, undefined, 1, {}, ["/records"]]) {
      expect(safeNextPath(value)).toBe("/");
    }
  });

  it("発行の入口そのものへは戻さない（同じ所を行き来しないため）", () => {
    expect(safeNextPath("/api/auth/start")).toBe("/");
    expect(safeNextPath("/api/auth/start?next=/records")).toBe("/");
  });
});

describe("AUTO_LOGIN_TRIED_COOKIE", () => {
  it("名前は固定（proxyと発行の入口で同じ値を見る）", () => {
    expect(AUTO_LOGIN_TRIED_COOKIE).toBe("kondate-session-tried");
  });
});
