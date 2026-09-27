import { renderAppIcon } from "@/lib/pwa/icon";

// manifest用のPNGアイコン（buildで静的に生成する）
export const dynamic = "force-static";

export function GET() {
  return renderAppIcon(512, { maskable: true });
}
