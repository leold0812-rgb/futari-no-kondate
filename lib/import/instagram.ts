/**
 * Instagramの投稿の文章（キャプション）を取り出す。
 * 通常の投稿ページはログインしていないと文章を返さないことが多いため、公開されている埋め込み用ページから読む。
 * 文章だけを扱い、画像・動画・コメントは取得しない。
 */

const POST_PATH = /^\/(?:[A-Za-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})(?:\/|$)/;

/** Instagramの投稿のURLなら、埋め込み用ページのURLを返す（それ以外はnull） */
export function instagramEmbedUrl(url: URL): string | null {
  if (!/^(www\.)?instagram\.com$/.test(url.hostname)) return null;
  const match = POST_PATH.exec(url.pathname);
  if (!match) return null;
  const kind = match[1] === "reels" ? "reel" : match[1];
  return `https://www.instagram.com/${kind}/${match[2]}/embed/captioned/`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** 埋め込み用ページのHTMLから投稿の文章を取り出す（先頭のアカウント名は除く）。見つからなければnull */
export function extractInstagramCaption(html: string): string | null {
  const match = /<div class="Caption">([\s\S]*?)<div class="CaptionComments"/.exec(html) ?? /<div class="Caption">([\s\S]*?)<\/div>/.exec(html);
  if (!match) return null;
  const withoutUser = match[1].replace(/<a class="CaptionUsername"[\s\S]*?<\/a>/, "");
  const text = decodeEntities(withoutUser.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text.slice(0, 8000) : null;
}
