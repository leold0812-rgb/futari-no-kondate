import { ImageResponse } from "next/og";

/**
 * アプリのアイコン（Muted Green地に白いお皿）をPNGで描く。public/icons/icon.svg と同じ図柄。
 * maskable（Androidが丸などに切り抜く）では、図柄を中央の安全領域（直径80%）に収める。
 * 文字は使わない（ImageResponseの既定フォントに日本語が無く、外部フォントも読み込まないため）。
 */
export function renderAppIcon(size: number, options: { maskable?: boolean; rounded?: boolean } = {}) {
  const plate = Math.round(size * (options.maskable ? 0.5 : 0.625));
  const ring = Math.round(plate * 0.7);
  const stroke = Math.max(2, Math.round(size * 0.027));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#75866a",
          borderRadius: options.rounded ? Math.round(size * 0.22) : 0,
        }}
      >
        <div
          style={{
            width: plate,
            height: plate,
            borderRadius: "50%",
            background: "#fffdf8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: ring, height: ring, borderRadius: "50%", border: `${stroke}px solid #ded8cc` }} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
