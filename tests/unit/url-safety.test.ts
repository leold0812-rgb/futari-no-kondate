import { describe, expect, it } from "vitest";
import { checkImportUrl, isBlockedAddress } from "@/lib/import/url-safety";

describe("取り込みURLの形式", () => {
  it.each(["https://www.example.com/recipe/1", "http://example.jp/a?b=1", "https://www.instagram.com/p/abc/"])(
    "%s は許可する",
    (url) => {
      expect(checkImportUrl(url).ok).toBe(true);
    },
  );

  it.each([
    ["file:///etc/passwd", "http または https"],
    ["javascript:alert(1)", "http または https"],
    ["ftp://example.com/", "http または https"],
    ["https://user:pass@example.com/", "ユーザー名"],
    ["https://example.com:8443/", "ポート"],
    ["http://localhost/", "端末内"],
    ["http://foo.localhost/", "端末内"],
    ["http://printer.local/", "端末内"],
    ["http://metadata.google.internal/", "端末内"],
    ["http://127.0.0.1/", "端末内"],
    ["http://169.254.169.254/latest/meta-data/", "端末内"],
    ["http://10.0.0.5/", "端末内"],
    ["http://[::1]/", "端末内"],
    ["http://[::ffff:127.0.0.1]/", "端末内"],
    ["http://2130706433/", "端末内"],
    ["http://0x7f.1/", "端末内"],
    ["http://intranet/", "ドメイン名"],
    ["not a url", "形式"],
  ])("%s は拒否する（%s）", (url, reason) => {
    const result = checkImportUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });
});

describe("接続先IPの判定", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "64:ff9b::7f00:1",
    "[::1]",
    "fe80::1%en0",
  ])("%s は拒否する", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s は許可する", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("IPとして読めない値は拒否する", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
  });
});
