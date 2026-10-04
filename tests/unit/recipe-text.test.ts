import { describe, expect, it } from "vitest";
import { extractInstagramCaption, instagramEmbedUrl } from "@/lib/import/instagram";
import { hasIngredientHeading, parseRecipeText } from "@/lib/import/recipe-text";

const CAPTION = `ダイエット中でも食べられる！
鶏むね肉のねぎ塩だれ🍋

【材料】2人分
・鶏むね肉 1枚(300g)
・長ねぎ 1/2本
・ごま油 大さじ1
☆塩 小さじ1/2
☆レモン汁 小1
黒こしょう 少々

【作り方】
① 鶏むね肉をそぎ切りにして、片栗粉をまぶす
② フライパンで両面を焼く
3. ねぎ塩だれをかける

ポイント
焼きすぎないこと！

#ダイエットレシピ #鶏むね肉`;

describe("parseRecipeText", () => {
  const recipe = parseRecipeText(CAPTION);

  it("料理名・人数・材料・作り方を読み取る", () => {
    expect(recipe?.name).toBe("ダイエット中でも食べられる!");
    expect(recipe?.servingsText).toBe("2人分");
    expect(recipe?.ingredients).toEqual(["鶏むね肉 1枚(300g)", "長ねぎ 1/2本", "ごま油 大さじ1", "塩 小さじ1/2", "レモン汁 小1", "黒こしょう 少々"]);
    expect(recipe?.instructions).toEqual(["鶏むね肉をそぎ切りにして、片栗粉をまぶす", "フライパンで両面を焼く", "ねぎ塩だれをかける"]);
  });

  it("ポイントやハッシュタグは作り方に入れない", () => {
    expect(recipe?.instructions.join("")).not.toContain("焼きすぎ");
    expect(recipe?.instructions.join("")).not.toContain("#");
  });

  it("「作り方」の見出しが無くても、番号付きの文から手順として読む", () => {
    const text = "材料\n卵 2個\n牛乳 100ml\n1. 卵と牛乳をよく混ぜ合わせる\n2. フライパンで焼いて完成";
    const parsed = parseRecipeText(text);
    expect(parsed?.ingredients).toEqual(["卵 2個", "牛乳 100ml"]);
    expect(parsed?.instructions).toEqual(["卵と牛乳をよく混ぜ合わせる", "フライパンで焼いて完成"]);
  });

  it("小見出し（A など）は材料にしない", () => {
    const parsed = parseRecipeText("材料\n豚肉 200g\n【A】\n醤油 大さじ1\n作り方\n焼く");
    expect(parsed?.ingredients).toEqual(["豚肉 200g", "醤油 大さじ1"]);
  });

  it("「材料」の見出しが無い文章は読み取らない（推測しない）", () => {
    const promo = "「動画」とコメントで、1週間だけ無料で受け取れます。\n\n痩せた今も、僕は週3でラーメンを食べています。";
    expect(parseRecipeText(promo)).toBeNull();
    expect(hasIngredientHeading(promo)).toBe(false);
    expect(hasIngredientHeading(CAPTION)).toBe(true);
  });
});

describe("Instagramの投稿", () => {
  it.each([
    ["https://www.instagram.com/reel/Dd1BtToBbWg/?stkn=abc", "https://www.instagram.com/reel/Dd1BtToBbWg/embed/captioned/"],
    ["https://www.instagram.com/p/Cabc_123-x/", "https://www.instagram.com/p/Cabc_123-x/embed/captioned/"],
    ["https://instagram.com/reels/Dd1BtToBbWg", "https://www.instagram.com/reel/Dd1BtToBbWg/embed/captioned/"],
    ["https://www.instagram.com/some.user/p/Cabc_123-x/", "https://www.instagram.com/p/Cabc_123-x/embed/captioned/"],
  ])("%s → 埋め込み用ページ", (url, expected) => {
    expect(instagramEmbedUrl(new URL(url))).toBe(expected);
  });

  it.each(["https://www.instagram.com/some.user/", "https://example.com/p/Cabc_123-x/", "https://evil-instagram.com/p/Cabc_123-x/"])(
    "%s は投稿のURLではない",
    (url) => {
      expect(instagramEmbedUrl(new URL(url))).toBeNull();
    },
  );

  it("埋め込み用ページから文章だけを取り出す（アカウント名・コメントは除く）", () => {
    const html =
      '<div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/x/" target="_blank">cook.user</a><br /><br />' +
      "&#x9d8f;&#x306e;&#x7167;&#x308a;&#x713c;&#x304d;<br />&#12304;材料&#12305;<br />鶏もも肉 300g &amp; 塩<br />" +
      '<a href="https://www.instagram.com/explore/tags/x/">#レシピ</a><div class="CaptionComments"><a>コメント</a></div></div>';
    expect(extractInstagramCaption(html)).toBe("鶏の照り焼き\n【材料】\n鶏もも肉 300g & 塩\n#レシピ");
  });

  it("文章が無いページ（ログイン画面など）はnull", () => {
    expect(extractInstagramCaption("<html><body>Log in</body></html>")).toBeNull();
  });
});
