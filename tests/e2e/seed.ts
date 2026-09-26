import { createClient } from "@supabase/supabase-js";

/**
 * E2E用のテストデータ（CIのローカルSupabaseだけ）。画面から何件も登録すると遅いため、管理者権限で直接入れる。
 * 接続先がローカル以外なら実行しない。
 */
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("E2Eのseedはローカルでだけ実行します");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** 主菜（READY）のレシピを作る。既に同名があれば作らない */
export async function seedMainRecipes(names: string[], options: { dishType?: "MAIN" | "SIDE" | "SOUP" } = {}) {
  const client = admin();
  const { data: space } = await client.from("couple_spaces").select("id").limit(1).single();
  const spaceId = space!.id as string;
  const { data: existing } = await client.from("recipes").select("name").eq("couple_space_id", spaceId).in("name", names);
  const missing = names.filter((n) => !existing?.some((e) => e.name === n));
  for (const name of missing) {
    const { data: recipe, error } = await client
      .from("recipes")
      .insert({
        couple_space_id: spaceId,
        name,
        dish_type: options.dishType ?? "MAIN",
        status: "READY",
        servings: 2,
        cooking_minutes: 20,
        instructions: ["材料を切る", "加熱する"],
        main_category: "MEAT",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { data: ingredient } = await client
      .from("ingredients")
      .insert({ couple_space_id: spaceId, name: `${name}の材料`, category: "VEGETABLE", storage_days: 5 })
      .select("id")
      .single();
    await client.from("recipe_ingredients").insert({
      couple_space_id: spaceId,
      recipe_id: recipe!.id,
      ingredient_id: ingredient?.id ?? null,
      raw_name: `${name}の材料`,
      quantity: 1,
      unit: "個",
      is_main: true,
    });
  }
}
