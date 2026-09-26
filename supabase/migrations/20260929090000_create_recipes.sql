-- Gate 2: レシピ・材料・評価・お気に入り・料理画像
--
-- 共有テーブル（ingredients / recipes / recipe_ingredients）の共通方針:
--   * couple_space_id の既定値は呼び出し元のspace（private.current_couple_space_id()）。
--   * RLSで「自分のspaceの行だけ」読み書きできる。anonには一切の権限を与えない。
--   * 子テーブルは (親id, couple_space_id) の複合外部キーで、別spaceの親を参照できないようにする。
-- 個人の嗜好（recipe_ratings / recipe_favorites）は同じspaceの2人が読め、本人の行だけ変更できる。
-- レシピは論理削除（deleted_at）。物理削除の権限は与えない（履歴・献立から参照されるため）。

-- ---------------------------------------------------------------------------
-- ingredients（材料マスタ。spaceごと）
-- ---------------------------------------------------------------------------
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null default private.current_couple_space_id()
    references public.couple_spaces (id) on delete cascade,
  name text not null constraint ingredients_name_length check (char_length(btrim(name)) between 1 and 40),
  category text not null default 'OTHER' constraint ingredients_category_check check (
    category in ('VEGETABLE', 'MEAT', 'FISH', 'EGG_DAIRY', 'SOY', 'GRAIN', 'SEASONING', 'DRY_CANNED', 'FROZEN', 'OTHER')
  ),
  default_unit text constraint ingredients_default_unit_length check (
    default_unit is null or char_length(default_unit) between 1 and 20
  ),
  -- 購入日からの保存目安（日）。「そろそろ使いたい」の算出に使う。nullは目安なし
  storage_days integer constraint ingredients_storage_days_range check (storage_days is null or storage_days between 1 and 365),
  aliases text[] not null default '{}' constraint ingredients_aliases_count check (cardinality(aliases) <= 20),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint ingredients_id_space_key unique (id, couple_space_id)
);

comment on table public.ingredients is '材料マスタ（CoupleSpace共有）。在庫・買い物の合算単位';

create unique index ingredients_space_name_key on public.ingredients (couple_space_id, lower(btrim(name)));

create trigger ingredients_set_updated_at
  before update on public.ingredients
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- recipes
-- ---------------------------------------------------------------------------
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null default private.current_couple_space_id()
    references public.couple_spaces (id) on delete cascade,
  name text not null constraint recipes_name_length check (char_length(btrim(name)) between 1 and 80),
  -- URL_ONLY: URLだけ保存（解析失敗・未解析） / DRAFT: 材料・手順が未確認 / READY: 献立に使える
  status text not null default 'READY' constraint recipes_status_check check (status in ('URL_ONLY', 'DRAFT', 'READY')),
  source_url text constraint recipes_source_url_check check (
    source_url is null or (char_length(source_url) <= 2048 and source_url ~ '^https?://')
  ),
  image_path text constraint recipes_image_path_length check (image_path is null or char_length(image_path) <= 300),
  dish_type text not null default 'MAIN' constraint recipes_dish_type_check check (dish_type in ('MAIN', 'SIDE', 'SOUP')),
  -- 推薦の偏り補正に使う大分類
  main_category text constraint recipes_main_category_check check (
    main_category is null or main_category in ('MEAT', 'FISH', 'EGG_SOY', 'NOODLE', 'RICE', 'VEGETABLE', 'OTHER')
  ),
  cuisine text constraint recipes_cuisine_check check (
    cuisine is null or cuisine in ('JAPANESE', 'WESTERN', 'CHINESE', 'KOREAN', 'ETHNIC', 'OTHER')
  ),
  servings smallint not null default 2 constraint recipes_servings_range check (servings between 1 and 8),
  cooking_minutes smallint constraint recipes_cooking_minutes_range check (cooking_minutes is null or cooking_minutes between 1 and 600),
  -- 手順（文字列の配列）
  instructions jsonb not null default '[]'::jsonb constraint recipes_instructions_array check (
    jsonb_typeof(instructions) = 'array' and jsonb_array_length(instructions) <= 50
  ),
  high_cost boolean not null default false,
  special_seasoning boolean not null default false,
  one_dish boolean not null default false,
  tags text[] not null default '{}' constraint recipes_tags_count check (cardinality(tags) <= 10),
  memo text constraint recipes_memo_length check (memo is null or char_length(memo) <= 2000),
  -- 1人前の栄養（手入力 または 食品成分表からの計算）。値を推測して入れない
  energy_kcal numeric(7, 1) constraint recipes_energy_range check (energy_kcal is null or energy_kcal between 0 and 5000),
  protein_g numeric(6, 1) constraint recipes_protein_range check (protein_g is null or protein_g between 0 and 500),
  fat_g numeric(6, 1) constraint recipes_fat_range check (fat_g is null or fat_g between 0 and 500),
  carbs_g numeric(6, 1) constraint recipes_carbs_range check (carbs_g is null or carbs_g between 0 and 1000),
  nutrition_source text constraint recipes_nutrition_source_check check (
    nutrition_source is null or nutrition_source in ('MANUAL', 'CALCULATED')
  ),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  deleted_at timestamp with time zone,
  constraint recipes_id_space_key unique (id, couple_space_id)
);

comment on table public.recipes is 'レシピ（CoupleSpace共有）。deleted_atによる論理削除';

create index recipes_space_active_idx on public.recipes (couple_space_id, dish_type) where deleted_at is null;

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- recipe_ingredients
-- ---------------------------------------------------------------------------
create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null,
  couple_space_id uuid not null default private.current_couple_space_id(),
  ingredient_id uuid,
  raw_name text not null constraint recipe_ingredients_raw_name_length check (char_length(btrim(raw_name)) between 1 and 60),
  -- 数量が無い（少々・適量など）場合はnull
  quantity numeric(10, 2) constraint recipe_ingredients_quantity_positive check (quantity is null or quantity > 0),
  unit text constraint recipe_ingredients_unit_length check (unit is null or char_length(unit) between 1 and 20),
  note text constraint recipe_ingredients_note_length check (note is null or char_length(note) <= 60),
  -- 推薦の「在庫で主要材料を賄える」判定に使う
  is_main boolean not null default false,
  sort_order smallint not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint recipe_ingredients_recipe_fkey foreign key (recipe_id, couple_space_id)
    references public.recipes (id, couple_space_id) on delete cascade,
  constraint recipe_ingredients_ingredient_fkey foreign key (ingredient_id, couple_space_id)
    references public.ingredients (id, couple_space_id) on delete set null (ingredient_id)
);

create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, sort_order);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);

-- ---------------------------------------------------------------------------
-- recipe_ratings / recipe_favorites（本人の嗜好。同じspaceの2人が読める）
-- ---------------------------------------------------------------------------
create table public.recipe_ratings (
  recipe_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  couple_space_id uuid not null default private.current_couple_space_id(),
  rating text not null constraint recipe_ratings_rating_check check (rating in ('MAKE_AGAIN', 'NORMAL', 'NEVER_AGAIN')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (recipe_id, user_id),
  constraint recipe_ratings_recipe_fkey foreign key (recipe_id, couple_space_id)
    references public.recipes (id, couple_space_id) on delete cascade
);

create trigger recipe_ratings_set_updated_at
  before update on public.recipe_ratings
  for each row execute function private.set_updated_at();

create table public.recipe_favorites (
  recipe_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  couple_space_id uuid not null default private.current_couple_space_id(),
  created_at timestamp with time zone not null default now(),
  primary key (recipe_id, user_id),
  constraint recipe_favorites_recipe_fkey foreign key (recipe_id, couple_space_id)
    references public.recipes (id, couple_space_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- grants（既定privilegesを外してから最小限）
-- ---------------------------------------------------------------------------
revoke all on table public.ingredients, public.recipes, public.recipe_ingredients,
  public.recipe_ratings, public.recipe_favorites from anon, authenticated;

grant select, insert, update, delete on table public.ingredients to authenticated;
grant select, insert, update on table public.recipes to authenticated;
grant select, insert, update, delete on table public.recipe_ingredients to authenticated;
grant select, insert, update, delete on table public.recipe_ratings to authenticated;
grant select, insert, delete on table public.recipe_favorites to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_ratings enable row level security;
alter table public.recipe_favorites enable row level security;

create policy ingredients_same_space on public.ingredients
  for all to authenticated
  using (couple_space_id = (select private.current_couple_space_id()))
  with check (couple_space_id = (select private.current_couple_space_id()));

create policy recipes_same_space on public.recipes
  for all to authenticated
  using (couple_space_id = (select private.current_couple_space_id()))
  with check (couple_space_id = (select private.current_couple_space_id()));

create policy recipe_ingredients_same_space on public.recipe_ingredients
  for all to authenticated
  using (couple_space_id = (select private.current_couple_space_id()))
  with check (couple_space_id = (select private.current_couple_space_id()));

create policy recipe_ratings_select_same_space on public.recipe_ratings
  for select to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));
create policy recipe_ratings_write_own on public.recipe_ratings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and couple_space_id = (select private.current_couple_space_id()));
create policy recipe_ratings_update_own on public.recipe_ratings
  for update to authenticated
  using (user_id = (select auth.uid()) and couple_space_id = (select private.current_couple_space_id()))
  with check (user_id = (select auth.uid()) and couple_space_id = (select private.current_couple_space_id()));
create policy recipe_ratings_delete_own on public.recipe_ratings
  for delete to authenticated
  using (user_id = (select auth.uid()) and couple_space_id = (select private.current_couple_space_id()));

create policy recipe_favorites_select_same_space on public.recipe_favorites
  for select to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));
create policy recipe_favorites_insert_own on public.recipe_favorites
  for insert to authenticated
  with check (user_id = (select auth.uid()) and couple_space_id = (select private.current_couple_space_id()));
create policy recipe_favorites_delete_own on public.recipe_favorites
  for delete to authenticated
  using (user_id = (select auth.uid()) and couple_space_id = (select private.current_couple_space_id()));

-- ---------------------------------------------------------------------------
-- レシピと材料をまとめて保存する（1 transaction）
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER：呼び出した利用者のRLSがそのまま効く。入力はサーバー（lib/validation/recipe.ts）で検証済みの前提だが、
-- 制約・RLSでも二重に守られる。材料名は材料マスタへ名前（大文字小文字・前後空白を無視）で対応付け、無ければ作る。
-- p_ingredients: [{ raw_name, quantity, unit, note, is_main, ingredient_name, category, storage_days }]
create function public.save_recipe(p_recipe_id uuid, p_recipe jsonb, p_ingredients jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_space uuid := private.current_couple_space_id();
  v_item jsonb;
  v_index integer;
  v_ingredient_id uuid;
begin
  if v_space is null then
    raise exception 'not a member of any couple space' using errcode = '42501';
  end if;
  if jsonb_typeof(p_ingredients) <> 'array' or jsonb_array_length(p_ingredients) > 60 then
    raise exception 'invalid ingredients' using errcode = '22023';
  end if;

  if p_recipe_id is null then
    insert into public.recipes (
      name, status, source_url, image_path, dish_type, main_category, cuisine, servings, cooking_minutes,
      instructions, high_cost, special_seasoning, one_dish, tags, memo,
      energy_kcal, protein_g, fat_g, carbs_g, nutrition_source
    )
    values (
      p_recipe ->> 'name',
      coalesce(p_recipe ->> 'status', 'READY'),
      p_recipe ->> 'source_url',
      p_recipe ->> 'image_path',
      coalesce(p_recipe ->> 'dish_type', 'MAIN'),
      p_recipe ->> 'main_category',
      p_recipe ->> 'cuisine',
      coalesce((p_recipe ->> 'servings')::smallint, 2),
      (p_recipe ->> 'cooking_minutes')::smallint,
      coalesce(p_recipe -> 'instructions', '[]'::jsonb),
      coalesce((p_recipe ->> 'high_cost')::boolean, false),
      coalesce((p_recipe ->> 'special_seasoning')::boolean, false),
      coalesce((p_recipe ->> 'one_dish')::boolean, false),
      coalesce(array(select jsonb_array_elements_text(coalesce(p_recipe -> 'tags', '[]'::jsonb))), '{}'),
      p_recipe ->> 'memo',
      (p_recipe ->> 'energy_kcal')::numeric,
      (p_recipe ->> 'protein_g')::numeric,
      (p_recipe ->> 'fat_g')::numeric,
      (p_recipe ->> 'carbs_g')::numeric,
      p_recipe ->> 'nutrition_source'
    )
    returning id into v_id;
  else
    update public.recipes as r
    set name = p_recipe ->> 'name',
        status = coalesce(p_recipe ->> 'status', 'READY'),
        source_url = p_recipe ->> 'source_url',
        image_path = case when p_recipe ? 'image_path' then p_recipe ->> 'image_path' else r.image_path end,
        dish_type = coalesce(p_recipe ->> 'dish_type', 'MAIN'),
        main_category = p_recipe ->> 'main_category',
        cuisine = p_recipe ->> 'cuisine',
        servings = coalesce((p_recipe ->> 'servings')::smallint, 2),
        cooking_minutes = (p_recipe ->> 'cooking_minutes')::smallint,
        instructions = coalesce(p_recipe -> 'instructions', '[]'::jsonb),
        high_cost = coalesce((p_recipe ->> 'high_cost')::boolean, false),
        special_seasoning = coalesce((p_recipe ->> 'special_seasoning')::boolean, false),
        one_dish = coalesce((p_recipe ->> 'one_dish')::boolean, false),
        tags = coalesce(array(select jsonb_array_elements_text(coalesce(p_recipe -> 'tags', '[]'::jsonb))), '{}'),
        memo = p_recipe ->> 'memo',
        energy_kcal = (p_recipe ->> 'energy_kcal')::numeric,
        protein_g = (p_recipe ->> 'protein_g')::numeric,
        fat_g = (p_recipe ->> 'fat_g')::numeric,
        carbs_g = (p_recipe ->> 'carbs_g')::numeric,
        nutrition_source = p_recipe ->> 'nutrition_source'
    where r.id = p_recipe_id and r.deleted_at is null
    returning r.id into v_id;
    if v_id is null then
      raise exception 'recipe not found' using errcode = 'P0002';
    end if;
    delete from public.recipe_ingredients as ri where ri.recipe_id = v_id;
  end if;

  for v_item, v_index in
    select value, ordinality::integer from jsonb_array_elements(p_ingredients) with ordinality
  loop
    v_ingredient_id := null;
    if coalesce(btrim(v_item ->> 'ingredient_name'), '') <> '' then
      insert into public.ingredients (name, category, storage_days, default_unit)
      values (
        btrim(v_item ->> 'ingredient_name'),
        coalesce(v_item ->> 'category', 'OTHER'),
        (v_item ->> 'storage_days')::integer,
        nullif(v_item ->> 'unit', '')
      )
      on conflict (couple_space_id, lower(btrim(name))) do nothing;

      select i.id into v_ingredient_id
      from public.ingredients as i
      where i.couple_space_id = v_space
        and lower(btrim(i.name)) = lower(btrim(v_item ->> 'ingredient_name'));
    end if;

    insert into public.recipe_ingredients (
      recipe_id, ingredient_id, raw_name, quantity, unit, note, is_main, sort_order
    )
    values (
      v_id,
      v_ingredient_id,
      v_item ->> 'raw_name',
      (v_item ->> 'quantity')::numeric,
      nullif(v_item ->> 'unit', ''),
      nullif(v_item ->> 'note', ''),
      coalesce((v_item ->> 'is_main')::boolean, false),
      v_index
    );
  end loop;

  return v_id;
end;
$$;

revoke all on function public.save_recipe(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_recipe(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 料理画像（Supabase Storage、private bucket）
-- ---------------------------------------------------------------------------
-- パスは <couple_space_id>/<recipe_id>/<ファイル名>。先頭フォルダが自分のspaceの場合だけ読み書きできる。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-images', 'recipe-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy recipe_images_select_same_space on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = (select private.current_couple_space_id())::text
  );
create policy recipe_images_insert_same_space on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = (select private.current_couple_space_id())::text
  );
create policy recipe_images_update_same_space on storage.objects
  for update to authenticated
  using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = (select private.current_couple_space_id())::text
  )
  with check (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = (select private.current_couple_space_id())::text
  );
create policy recipe_images_delete_same_space on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'recipe-images'
    and (storage.foldername(name))[1] = (select private.current_couple_space_id())::text
  );
