-- Gate 2b: 食品成分表マスタと材料の対応付け（栄養の計算）
--
-- 方針（docs/product-spec.md 機能要件「カロリー/PFC」、docs/recommendation.md「栄養基準値は…数値を捏造しない」）:
--   * 食品成分表（日本食品標準成分表）の値は、ユーザーが公式サイトから入手したデータを管理スクリプトで取り込む
--     （scripts/nutrition/import-food-composition.mts）。アプリやmigrationに数値を書かない。
--   * 全spaceで共通の参照データ。利用者は読むだけ、書き込みはservice role（取り込みスクリプト）だけ。
--   * 材料（spaceごと）に「対応する食品」と重さへの換算（1個当たりg・1ml当たりg）を持たせ、レシピの1人前をアプリで計算する。
--     換算できない材料があれば計算しない（推測で補わない）。

create table public.food_composition_items (
  id uuid primary key default gen_random_uuid(),
  -- 例：日本食品標準成分表（八訂）増補2023年
  source_version text not null constraint food_composition_items_version_length check (char_length(source_version) between 1 and 60),
  food_number text not null constraint food_composition_items_number_length check (char_length(food_number) between 1 and 20),
  name text not null constraint food_composition_items_name_length check (char_length(name) between 1 and 200),
  -- 可食部100g当たり
  energy_kcal numeric(7, 1) not null constraint food_composition_items_energy_nonnegative check (energy_kcal >= 0),
  protein_g numeric(6, 1) not null constraint food_composition_items_protein_nonnegative check (protein_g >= 0),
  fat_g numeric(6, 1) not null constraint food_composition_items_fat_nonnegative check (fat_g >= 0),
  carbs_g numeric(6, 1) not null constraint food_composition_items_carbs_nonnegative check (carbs_g >= 0),
  created_at timestamp with time zone not null default now(),
  constraint food_composition_items_version_number_key unique (source_version, food_number)
);

comment on table public.food_composition_items is '食品成分表（可食部100g当たり）。公式データを取り込みスクリプトで登録する参照データ';

revoke all on table public.food_composition_items from anon, authenticated;
grant select on table public.food_composition_items to authenticated;
alter table public.food_composition_items enable row level security;
create policy food_composition_items_read on public.food_composition_items for select to authenticated using (true);

-- 材料の対応付け（spaceごと。利用者が材料の設定画面で編集する）
alter table public.ingredients
  add column food_item_id uuid references public.food_composition_items (id) on delete set null,
  add column grams_per_unit numeric(8, 2) constraint ingredients_grams_per_unit_positive check (grams_per_unit is null or grams_per_unit > 0),
  add column grams_per_ml numeric(6, 3) constraint ingredients_grams_per_ml_positive check (grams_per_ml is null or grams_per_ml > 0);

-- ご飯（めし・精白米）100g当たり。食品番号は取り込んだ版に合わせて指定できる（既定は八訂の「こめ［水稲めし］精白米 うるち米」）
-- 複数の版を取り込んだ場合は、最後に取り込んだ版を使う（版名の文字列順には頼らない）
create function public.rice_nutrition_per_100g(p_food_number text default '01088')
returns table (energy_kcal numeric, protein_g numeric, fat_g numeric, carbs_g numeric, source_version text)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.energy_kcal, f.protein_g, f.fat_g, f.carbs_g, f.source_version
  from public.food_composition_items as f
  where f.food_number = p_food_number
  order by f.created_at desc, f.source_version desc
  limit 1
$$;

revoke all on function public.rice_nutrition_per_100g(text) from public, anon;
grant execute on function public.rice_nutrition_per_100g(text) to authenticated;

-- 作ったときの栄養の写し（Gate 7の private.meal_nutrition）に、ご飯の栄養を加える。
-- 食品成分表に「めし（精白米）」があれば各自のご飯量で加算し、無ければ従来どおり「ご飯」を未登録として残す。
create or replace function private.meal_nutrition(p_space uuid, p_recipe_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with dishes as (
    select r.name, r.energy_kcal, r.protein_g, r.fat_g, r.carbs_g
    from unnest(p_recipe_ids) as u(id)
    join public.recipes as r on r.id = u.id and r.couple_space_id = p_space
  ),
  totals as (
    select coalesce(sum(d.energy_kcal), 0) as energy,
           coalesce(sum(d.protein_g), 0) as protein,
           coalesce(sum(d.fat_g), 0) as fat,
           coalesce(sum(d.carbs_g), 0) as carbs,
           -- エネルギー・PFCのどれかが未登録の料理は、未登録として残す（0として扱わない）
           coalesce(jsonb_agg(d.name) filter (
             where d.energy_kcal is null or d.protein_g is null or d.fat_g is null or d.carbs_g is null
           ), '[]'::jsonb) as missing
    from dishes as d
  ),
  rice as (
    select f.energy_kcal, f.protein_g, f.fat_g, f.carbs_g
    from public.food_composition_items as f
    where f.food_number = '01088'
    order by f.created_at desc, f.source_version desc
    limit 1
  )
  select coalesce(jsonb_object_agg(
    p.id::text,
    jsonb_build_object(
      'energyKcal', round(t.energy + coalesce(rc.energy_kcal * coalesce(rp.grams, 0) / 100, 0)),
      'proteinG', round(t.protein + coalesce(rc.protein_g * coalesce(rp.grams, 0) / 100, 0), 1),
      'fatG', round(t.fat + coalesce(rc.fat_g * coalesce(rp.grams, 0) / 100, 0), 1),
      'carbsG', round(t.carbs + coalesce(rc.carbs_g * coalesce(rp.grams, 0) / 100, 0), 1),
      'riceGrams', coalesce(rp.grams, 0),
      'missing', t.missing || case when coalesce(rp.grams, 0) > 0 and rc.energy_kcal is null then '["ご飯"]'::jsonb else '[]'::jsonb end,
      'complete', jsonb_array_length(t.missing) = 0 and (coalesce(rp.grams, 0) = 0 or rc.energy_kcal is not null)
    )
  ), '{}'::jsonb)
  from public.profiles as p
  cross join totals as t
  left join rice as rc on true
  left join public.rice_portions as rp on rp.user_id = p.id
  where p.couple_space_id = p_space
$$;

revoke all on function private.meal_nutrition(uuid, uuid[]) from public, anon, authenticated, service_role;
