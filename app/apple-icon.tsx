import { renderAppIcon } from "@/lib/pwa/icon";

// iPhoneのホーム画面用アイコン（角丸はiOSが付けるため四角のまま）
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(180);
}
