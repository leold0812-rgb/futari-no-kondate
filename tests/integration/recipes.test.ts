/**
 * Gate 2: レシピのサービス層（lib/services/recipes.ts）をローカルSupabaseで検証する。
 * 利用者のsession（RLS）で保存・一覧・検索・評価・論理削除・画像の保存先を確かめる。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RecipeInput } from "@/lib/validation/recipe";
import { createAdminClient, readLocalSupabaseEnv, type LocalSupabaseEnv } from "./helpers/local-supabase";

vi.mock("server-only", () => ({}));
const { getRecipeDetail, listRecipes, saveRecipe, setFavorite, setRating, softDeleteRecipe, RECIPE_IMAGE_BUCKET } = await import(
  "@/lib/services/recipes"
);

let env: LocalSupabaseEnv;
let admin: SupabaseClient;
const userIds: string[] = [];
const spaceIds: string[] = [];

type Member = { userId: string; spaceId: string; client: SupabaseClient };

async function signedInMember(spaceId: string, name: string): Promise<Member> {
  const email = `recipes-${randomUUID()}@futari-no-kondate.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message);
  userIds.push(data.user.id);
  await admin.from("profiles").insert({ id: data.user.id, couple_space_id: spaceId, display_name: name });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const client = createClient(env.url, env.anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: verifyError } = await client.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "email" });
  if (verifyError) throw new Error(verifyError.message);
  return { userId: data.user.id, spaceId, client };
}

async function newSpace() {
  const { data } = await admin.from("couple_spaces").insert({}).select("id").single();
  spaceIds.push(data!.id as string);
  return data!.id as string;
}

const recipe = (overrides: Partial<RecipeInput> = {}): RecipeInput => ({
  name: "鶏の照り焼き",
  dishType: "MAIN",
  mainCategory: "MEAT",
  cuisine: "JAPANESE",
  servings: 2,
  cookingMinutes: 20,
  sourceUrl: null,
  instructions: ["焼く", "タレを絡める"],
  ingredients: [
    { rawName: "鶏もも肉", quantity: 300, unit: "g", note: null, isMain: true },
    { rawName: "醤油", quantity: 2, unit: "大さじ", note: null, isMain: false },
  ],
  highCost: false,
  specialSeasoning: false,
  oneDish: false,
  tags: ["高タンパク"],
  memo: null,
  nutrition: { energyKcal: null, proteinG: null, fatG: null, carbsG: null },
  ...overrides,
});

let a: Member;
let b: Member;
let d: Member;

beforeAll(async () => {
  env = readLocalSupabaseEnv();
  admin = createAdminClient(env);
  const sp1 = await newSpace();
  const sp2 = await newSpace();
  a = await signedInMember(sp1, "recipes-a");
  b = await signedInMember(sp1, "recipes-b");
  d = await signedInMember(sp2, "recipes-d");
});

afterAll(async () => {
  if (!admin) return;
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  for (const id of spaceIds) {
    const { data: objects } = await admin.storage.from(RECIPE_IMAGE_BUCKET).list(id, { limit: 100 });
    for (const folder of objects ?? []) {
      const { data: files } = await admin.storage.from(RECIPE_IMAGE_BUCKET).list(`${id}/${folder.name}`);
      await admin.storage.from(RECIPE_IMAGE_BUCKET).remove((files ?? []).map((f) => `${id}/${folder.name}/${f.name}`));
    }
    await admin.from("recipes").delete().eq("couple_space_id", id);
    await admin.from("couple_spaces").delete().eq("id", id);
  }
});

describe("レシピの保存と共有", () => {
  let recipeId = "";

  it("保存したレシピは同じspaceの2人が読め、別spaceからは見えない", async () => {
    recipeId = await saveRecipe(a.client, null, recipe());
    const fromB = await getRecipeDetail(b.client, b.userId, recipeId);
    expect(fromB?.name).toBe("鶏の照り焼き");
    expect(fromB?.status).toBe("READY");
    expect(fromB?.ingredients.map((i) => [i.rawName, i.quantity, i.unit])).toEqual([
      ["鶏もも肉", 300, "g"],
      ["醤油", 2, "大さじ"],
    ]);
    expect(await getRecipeDetail(d.client, d.userId, recipeId)).toBeNull();
    expect(await listRecipes(d.client, d.userId)).toHaveLength(0);
  });

  it("編集で材料を置き換え、材料が無ければ下書きになる", async () => {
    await saveRecipe(b.client, recipeId, recipe({ name: "照り焼き（改）", ingredients: [] }));
    const detail = await getRecipeDetail(a.client, a.userId, recipeId);
    expect(detail?.name).toBe("照り焼き（改）");
    expect(detail?.status).toBe("DRAFT");
    expect(detail?.ingredients).toHaveLength(0);
    await saveRecipe(a.client, recipeId, recipe());
  });

  it("別spaceの利用者は上書きできない", async () => {
    await expect(saveRecipe(d.client, recipeId, recipe({ name: "hacked" }))).rejects.toThrow();
    expect((await getRecipeDetail(a.client, a.userId, recipeId))?.name).toBe("鶏の照り焼き");
  });

  it("料理名・材料名で検索でき、絞り込み・評価・お気に入りが反映される", async () => {
    const soupId = await saveRecipe(a.client, null, recipe({ name: "豆腐の味噌汁", dishType: "SOUP", mainCategory: null, ingredients: [{ rawName: "絹豆腐", quantity: 0.5, unit: "丁", note: null, isMain: true }] }));
    expect((await listRecipes(a.client, a.userId, { q: "照り" })).map((r) => r.id)).toEqual([recipeId]);
    expect((await listRecipes(a.client, a.userId, { q: "豆腐" })).map((r) => r.id)).toEqual([soupId]);
    expect((await listRecipes(a.client, a.userId, { dishType: "SOUP" })).map((r) => r.id)).toEqual([soupId]);
    expect((await listRecipes(a.client, a.userId, { tag: "高タンパク" })).length).toBe(2);

    await setRating(a.client, a.userId, recipeId, "MAKE_AGAIN");
    await setRating(b.client, b.userId, recipeId, "NORMAL");
    await setFavorite(b.client, b.userId, soupId, true);
    const fromA = await listRecipes(a.client, a.userId, { sort: "rating" });
    expect(fromA[0]).toMatchObject({ id: recipeId, myRating: "MAKE_AGAIN", partnerRating: "NORMAL" });
    expect((await listRecipes(b.client, b.userId, { favoriteOnly: true })).map((r) => r.id)).toEqual([soupId]);
    expect((await listRecipes(a.client, a.userId, { favoriteOnly: true })).length).toBe(0);

    await setRating(a.client, a.userId, recipeId, null);
    expect((await getRecipeDetail(a.client, a.userId, recipeId))?.myRating).toBeNull();
  });

  it("論理削除したレシピは一覧・詳細に出ない", async () => {
    const tempId = await saveRecipe(a.client, null, recipe({ name: "削除テスト" }));
    await softDeleteRecipe(b.client, tempId);
    expect(await getRecipeDetail(a.client, a.userId, tempId)).toBeNull();
    expect((await listRecipes(a.client, a.userId)).some((r) => r.id === tempId)).toBe(false);
  });

  it("画像は自分のspaceのフォルダにだけ保存でき、同じspaceの相手は一時URLで読める", async () => {
    const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
    const own = `${a.spaceId}/${recipeId}/${randomUUID()}.png`;
    const ok = await a.client.storage.from(RECIPE_IMAGE_BUCKET).upload(own, png, { contentType: "image/png" });
    expect(ok.error).toBeNull();
    const other = await a.client.storage
      .from(RECIPE_IMAGE_BUCKET)
      .upload(`${d.spaceId}/x/${randomUUID()}.png`, png, { contentType: "image/png" });
    expect(other.error).not.toBeNull();

    const signed = await b.client.storage.from(RECIPE_IMAGE_BUCKET).createSignedUrl(own, 60);
    expect(signed.error).toBeNull();
    const denied = await d.client.storage.from(RECIPE_IMAGE_BUCKET).createSignedUrl(own, 60);
    expect(denied.error).not.toBeNull();
  });
});
