import { describe, expect, it } from "vitest";
import { decodeEntities, extractJsonLdRecipe, parseDurationMinutes, parseServings, summarizePage } from "@/lib/import/extract";

const jsonLdPage = `<!doctype html><html><head>
<title>鶏の照り焼き | 架空レシピサイト</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"架空"},
{"@type":["Recipe"],"name":"鶏の照り焼き &amp; ごはん","recipeYield":["2","2人分"],"totalTime":"PT25M",
"image":{"@type":"ImageObject","url":"https://img.example.com/teri.jpg"},
"recipeIngredient":["鶏もも肉 300g","醤油 大さじ2","<b>みりん</b> 大さじ2"],
"recipeInstructions":[{"@type":"HowToSection","name":"下ごしらえ","itemListElement":[{"@type":"HowToStep","text":"鶏肉の筋を切る"}]},
{"@type":"HowToStep","text":"皮目から焼く"},"タレを絡める"],
"nutrition":{"@type":"NutritionInformation","calories":"480 kcal"}}]}</script>
</head><body><main><h1>見出し</h1></main></body></html>`;

describe("JSON-LDのRecipe", () => {
  it("@graph内のRecipeから材料・手順・人数・時間・画像・カロリーを取り出す", () => {
    expect(extractJsonLdRecipe(jsonLdPage)).toEqual({
      name: "鶏の照り焼き & ごはん",
      ingredients: ["鶏もも肉 300g", "醤油 大さじ2", "みりん 大さじ2"],
      instructions: ["鶏肉の筋を切る", "皮目から焼く", "タレを絡める"],
      servingsText: "2",
      totalMinutes: 25,
      imageUrl: "https://img.example.com/teri.jpg",
      energyKcal: 480,
    });
  });

  it("手順が1つの文字列でも句点・改行で分ける", () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"x","recipeIngredient":["a"],"recipeInstructions":"切る。焼く。\\n盛る"}</script>`;
    expect(extractJsonLdRecipe(html)?.instructions).toEqual(["切る。", "焼く。", "盛る"]);
  });

  it("壊れたJSON・Recipe以外・中身の無いRecipeは使わない", () => {
    expect(extractJsonLdRecipe(`<script type="application/ld+json">{broken</script>`)).toBeNull();
    expect(extractJsonLdRecipe(`<script type="application/ld+json">{"@type":"Article"}</script>`)).toBeNull();
    expect(extractJsonLdRecipe(`<script type="application/ld+json">{"@type":"Recipe","name":"x"}</script>`)).toBeNull();
  });
});

describe("AIへ渡す本文の要約", () => {
  it("OGP・本文を取り出し、scriptやナビゲーションを除く", () => {
    const html = `<html><head><meta property="og:title" content="豚汁"><meta name="description" content="具だくさん">
      <meta property="og:image" content="https://img.example.com/ton.jpg"></head>
      <body><nav>メニュー</nav><script>var secret = 1;</script><article><h2>材料</h2><ul><li>豚こま 150g</li><li>大根 1/4本</li></ul><p>煮る&amp;味噌を溶く</p></article><footer>©</footer></body></html>`;
    const summary = summarizePage(html);
    expect(summary.title).toBe("豚汁");
    expect(summary.description).toBe("具だくさん");
    expect(summary.imageUrl).toBe("https://img.example.com/ton.jpg");
    expect(summary.text).toContain("豚こま 150g");
    expect(summary.text).toContain("煮る&味噌を溶く");
    expect(summary.text).not.toContain("secret");
    expect(summary.text).not.toContain("メニュー");
  });

  it("本文は上限（8000文字）で切る", () => {
    const html = `<main>${"あ".repeat(20000)}</main>`;
    expect(summarizePage(html).text.length).toBe(8000);
  });
});

describe("補助の変換", () => {
  it.each([
    ["PT20M", 20],
    ["PT1H15M", 75],
    ["P0DT0H30M", 30],
    ["PT0M", null],
    ["20分", null],
  ])("期間 %s → %s分", (value, minutes) => {
    expect(parseDurationMinutes(value)).toBe(minutes);
  });

  it.each([
    ["2人分", 2],
    ["４人前", 4],
    ["serves 3", 3],
    ["12人分", null],
    [null, null],
  ])("人数 %s → %s", (text, n) => {
    expect(parseServings(text)).toBe(n);
  });

  it("文字実体参照を戻す", () => {
    expect(decodeEntities("&lt;a&gt; &#x3042; &#12356; &nbsp;&amp;")).toBe("<a> あ い  &");
  });
});
