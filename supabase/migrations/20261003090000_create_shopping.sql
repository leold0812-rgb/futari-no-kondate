-- Gate 6: 副菜・汁物の設定と買い物リスト（家にあるチェック・保険食材・購入済み・カテゴリ順）
--
-- 方針（docs/product-spec.md 週間計画 5〜7、docs/database.md 買い物）:
--   * 週の計画ごとに買い物リストを1つ（weekly_plan_id一意）。材料の合算・在庫差引はアプリ（lib/shopping）で計算して渡す。
--   * 「家にある」チェックは不足分を在庫へ登録（理由 HOME_CHECK）し、買う量から外す。外すと登録した在庫を戻す。
--   * 「購入済み」は買った量を在庫へ加算（理由 PURCHASE）。inventory_items.source_shopping_item_id の一意制約と
--     行ロックで二重加算を防ぐ（冪等）。取り消すと加算したlotを戻す（PURCHASE_UNDO）。購入済みの項目は消さず薄く表示する。
--   * 利用者は表を読むだけ。書き込みは関数（SECURITY DEFINER、自分のspaceかを確認）。在庫の変更は Gate 4 の内部関数だけで行う。

-- ---------------------------------------------------------------------------
-- 在庫の内部関数に、買い物・家にあるチェック用の理由を追加で許す入口は作らない（理由は下の関数が固定で渡す）
-- ---------------------------------------------------------------------------

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null references public.couple_spaces (id) on delete cascade,
  weekly_plan_id uuid,
  status text not null default 'DRAFT' constraint shopping_lists_status_check check (status in ('DRAFT', 'CONFIRMED')),
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint shopping_lists_plan_key unique (weekly_plan_id),
  constraint shopping_lists_plan_fkey foreign key (weekly_plan_id, couple_space_id)
    references public.weekly_plans (id, couple_space_id) on delete cascade,
  constraint shopping_lists_id_space_key unique (id, couple_space_id)
);

create trigger shopping_lists_set_updated_at
  before update on public.shopping_lists
  for each row execute function private.set_updated_at();

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null,
  couple_space_id uuid not null,
  ingredient_id uuid,
  name text not null constraint shopping_items_name_length check (char_length(btrim(name)) between 1 and 60),
  category text not null default 'OTHER' constraint shopping_items_category_check check (
    category in ('VEGETABLE', 'MEAT', 'FISH', 'EGG_DAIRY', 'SOY', 'GRAIN', 'SEASONING', 'DRY_CANNED', 'FROZEN', 'OTHER')
  ),
  -- 数量は基準単位（g / ml / 個 など）。数量の無い材料（少々など）はnullで「家にあるか確認」
  required_quantity numeric(10, 2) constraint shopping_items_required_nonnegative check (required_quantity is null or required_quantity >= 0),
  inventory_quantity numeric(10, 2) constraint shopping_items_inventory_nonnegative check (inventory_quantity is null or inventory_quantity >= 0),
  buy_quantity numeric(10, 2) constraint shopping_items_buy_nonnegative check (buy_quantity is null or buy_quantity >= 0),
  unit text constraint shopping_items_unit_length check (unit is null or char_length(unit) between 1 and 20),
  source text not null default 'PLAN' constraint shopping_items_source_check check (source in ('PLAN', 'INSURANCE', 'MANUAL')),
  -- 使うレシピ名（表示用）
  recipe_names text[] not null default '{}',
  home_checked boolean not null default false,
  home_check_lot_id uuid,
  purchased_at timestamp with time zone,
  purchased_by uuid references auth.users (id) on delete set null,
  inventory_lot_id uuid,
  position smallint not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint shopping_items_list_fkey foreign key (shopping_list_id, couple_space_id)
    references public.shopping_lists (id, couple_space_id) on delete cascade,
  constraint shopping_items_ingredient_fkey foreign key (ingredient_id, couple_space_id)
    references public.ingredients (id, couple_space_id) on delete set null (ingredient_id)
);

create index shopping_items_list_idx on public.shopping_items (shopping_list_id, category, position);

create trigger shopping_items_set_updated_at
  before update on public.shopping_items
  for each row execute function private.set_updated_at();

create table public.shopping_category_orders (
  couple_space_id uuid not null references public.couple_spaces (id) on delete cascade,
  category text not null constraint shopping_category_orders_category_check check (
    category in ('VEGETABLE', 'MEAT', 'FISH', 'EGG_DAIRY', 'SOY', 'GRAIN', 'SEASONING', 'DRY_CANNED', 'FROZEN', 'OTHER')
  ),
  position smallint not null,
  primary key (couple_space_id, category)
);

-- ---------------------------------------------------------------------------
-- grants / RLS（利用者は読むだけ）
-- ---------------------------------------------------------------------------
revoke all on table public.shopping_lists, public.shopping_items, public.shopping_category_orders from anon, authenticated;
grant select on table public.shopping_lists, public.shopping_items, public.shopping_category_orders to authenticated;

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
alter table public.shopping_category_orders enable row level security;

create policy shopping_lists_select_same_space on public.shopping_lists
  for select to authenticated using (couple_space_id = (select private.current_couple_space_id()));
create policy shopping_items_select_same_space on public.shopping_items
  for select to authenticated using (couple_space_id = (select private.current_couple_space_id()));
create policy shopping_category_orders_select_same_space on public.shopping_category_orders
  for select to authenticated using (couple_space_id = (select private.current_couple_space_id()));

-- ---------------------------------------------------------------------------
-- 副菜・汁物を設定する（確定済みの計画の献立セット。アプリがlib/recommendation/sidesで選んだ結果）
-- ---------------------------------------------------------------------------
-- p_sets: [{ meal_set_id, side_recipe_id, soup_recipe_id }]
create function public.set_meal_set_sides(p_plan_id uuid, p_sets jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
begin
  if not exists (select 1 from public.weekly_plans as p where p.id = p_plan_id and p.couple_space_id = v_space) then
    raise exception 'weekly plan not found' using errcode = 'P0002';
  end if;
  update public.meal_sets as m
  set side_recipe_id = nullif(s.value ->> 'side_recipe_id', '')::uuid,
      soup_recipe_id = nullif(s.value ->> 'soup_recipe_id', '')::uuid,
      version = m.version + 1
  from jsonb_array_elements(p_sets) as s
  where m.id = (s.value ->> 'meal_set_id')::uuid
    and m.weekly_plan_id = p_plan_id
    and m.couple_space_id = v_space
    and m.status = 'PLANNED';
exception
  when invalid_text_representation or datatype_mismatch then
    raise exception 'invalid meal sets' using errcode = '22023';
  when foreign_key_violation then
    raise exception 'recipe not found in this couple space' using errcode = '23503';
end;
$$;

-- ---------------------------------------------------------------------------
-- 買い物リストを作る（DRAFTなら項目を作り直す。確定済みなら何もしない）
-- ---------------------------------------------------------------------------
-- p_items: [{ ingredient_id, name, category, required_quantity, inventory_quantity, buy_quantity, unit, recipe_names }]
create function public.prepare_shopping_list(p_plan_id uuid, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_list public.shopping_lists;
begin
  if not exists (select 1 from public.weekly_plans as p where p.id = p_plan_id and p.couple_space_id = v_space) then
    raise exception 'weekly plan not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 300 then
    raise exception 'invalid items' using errcode = '22023';
  end if;

  insert into public.shopping_lists (couple_space_id, weekly_plan_id) values (v_space, p_plan_id)
  on conflict (weekly_plan_id) do nothing;
  select * into v_list from public.shopping_lists as l where l.weekly_plan_id = p_plan_id for update;
  if v_list.status <> 'DRAFT' then
    return v_list.id;
  end if;

  -- 家にあるチェックで登録した在庫は、作り直す前に戻す
  perform private.inventory_set_lot(v_space, i.home_check_lot_id, 0, 'HOME_CHECK')
  from public.shopping_items as i
  where i.shopping_list_id = v_list.id and i.home_check_lot_id is not null
    and exists (select 1 from public.inventory_items as l where l.id = i.home_check_lot_id);
  delete from public.shopping_items as i where i.shopping_list_id = v_list.id and i.source = 'PLAN';

  insert into public.shopping_items (
    shopping_list_id, couple_space_id, ingredient_id, name, category,
    required_quantity, inventory_quantity, buy_quantity, unit, recipe_names, position
  )
  select v_list.id,
         v_space,
         nullif(x.value ->> 'ingredient_id', '')::uuid,
         left(btrim(x.value ->> 'name'), 60),
         coalesce(x.value ->> 'category', 'OTHER'),
         (x.value ->> 'required_quantity')::numeric,
         (x.value ->> 'inventory_quantity')::numeric,
         (x.value ->> 'buy_quantity')::numeric,
         nullif(x.value ->> 'unit', ''),
         coalesce(array(select jsonb_array_elements_text(coalesce(x.value -> 'recipe_names', '[]'::jsonb))), '{}'),
         x.ordinality::smallint
  from jsonb_array_elements(p_items) with ordinality as x;
  return v_list.id;
exception
  when invalid_text_representation or datatype_mismatch or numeric_value_out_of_range then
    raise exception 'invalid items' using errcode = '22023';
  when foreign_key_violation then
    raise exception 'ingredient not found in this couple space' using errcode = '23503';
end;
$$;

-- ---------------------------------------------------------------------------
-- 家にあるチェック（DRAFTの間だけ）。チェックすると不足分を在庫へ登録し、買う量を0にする
-- ---------------------------------------------------------------------------
create function public.set_home_check(p_item_id uuid, p_checked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_item public.shopping_items;
  v_status text;
  v_lot uuid;
begin
  select * into v_item from public.shopping_items as i where i.id = p_item_id and i.couple_space_id = v_space for update;
  if not found then
    raise exception 'shopping item not found' using errcode = 'P0002';
  end if;
  select l.status into v_status from public.shopping_lists as l where l.id = v_item.shopping_list_id;
  if v_status <> 'DRAFT' then
    raise exception 'shopping list is already confirmed' using errcode = '55000';
  end if;
  if v_item.home_checked = coalesce(p_checked, false) then
    return; -- 冪等
  end if;

  if p_checked then
    if v_item.ingredient_id is not null and coalesce(v_item.buy_quantity, 0) > 0 then
      v_lot := private.inventory_add_lot(v_space, v_item.ingredient_id, v_item.buy_quantity, v_item.unit, null, 'HOME_CHECK', null);
    end if;
    update public.shopping_items as i
    set home_checked = true, home_check_lot_id = v_lot
    where i.id = p_item_id;
  else
    if v_item.home_check_lot_id is not null
       and exists (select 1 from public.inventory_items as l where l.id = v_item.home_check_lot_id) then
      perform private.inventory_set_lot(v_space, v_item.home_check_lot_id, 0, 'HOME_CHECK');
    end if;
    update public.shopping_items as i
    set home_checked = false, home_check_lot_id = null
    where i.id = p_item_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 保険食材・手動の項目を追加する（DRAFTの間だけ）
-- ---------------------------------------------------------------------------
create function public.add_shopping_item(
  p_list_id uuid,
  p_ingredient_id uuid,
  p_name text,
  p_category text,
  p_quantity numeric,
  p_unit text,
  p_source text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_list public.shopping_lists;
  v_id uuid;
begin
  if p_source not in ('INSURANCE', 'MANUAL') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  select * into v_list from public.shopping_lists as l where l.id = p_list_id and l.couple_space_id = v_space for update;
  if not found then
    raise exception 'shopping list not found' using errcode = 'P0002';
  end if;
  if p_source = 'INSURANCE' and v_list.status <> 'DRAFT' then
    raise exception 'shopping list is already confirmed' using errcode = '55000';
  end if;
  if p_ingredient_id is not null and exists (
    select 1 from public.shopping_items as i
    where i.shopping_list_id = p_list_id and i.ingredient_id = p_ingredient_id and i.source = p_source
  ) then
    select i.id into v_id from public.shopping_items as i
    where i.shopping_list_id = p_list_id and i.ingredient_id = p_ingredient_id and i.source = p_source limit 1;
    return v_id; -- 同じ保険食材の二重追加は1件にまとめる
  end if;

  insert into public.shopping_items (
    shopping_list_id, couple_space_id, ingredient_id, name, category, required_quantity, buy_quantity, unit, source, position
  )
  values (
    p_list_id, v_space, p_ingredient_id, left(btrim(p_name), 60), coalesce(p_category, 'OTHER'),
    p_quantity, p_quantity, nullif(btrim(p_unit), ''), p_source,
    (select coalesce(max(i.position), 0) + 1 from public.shopping_items as i where i.shopping_list_id = p_list_id)
  )
  returning id into v_id;
  return v_id;
exception
  when foreign_key_violation then
    raise exception 'ingredient not found in this couple space' using errcode = '23503';
end;
$$;

create function public.remove_shopping_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
begin
  delete from public.shopping_items as i
  where i.id = p_item_id and i.couple_space_id = v_space
    and i.source in ('INSURANCE', 'MANUAL') and i.purchased_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 買い物リストを確定する
-- ---------------------------------------------------------------------------
create function public.confirm_shopping_list(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
begin
  update public.shopping_lists as l
  set status = 'CONFIRMED', confirmed_at = coalesce(l.confirmed_at, now())
  where l.id = p_list_id and l.couple_space_id = v_space;
  if not found then
    raise exception 'shopping list not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 購入済み（1 transaction・冪等）。買った量を在庫へ加算し、取り消しで戻す
-- ---------------------------------------------------------------------------
create function public.set_purchased(p_item_id uuid, p_purchased boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_item public.shopping_items;
  v_lot uuid;
begin
  select * into v_item from public.shopping_items as i where i.id = p_item_id and i.couple_space_id = v_space for update;
  if not found then
    raise exception 'shopping item not found' using errcode = 'P0002';
  end if;

  if coalesce(p_purchased, false) then
    if v_item.purchased_at is not null then
      return; -- 二重送信・2人の同時操作でも在庫は1回だけ増える
    end if;
    if v_item.ingredient_id is not null and coalesce(v_item.buy_quantity, 0) > 0 then
      v_lot := private.inventory_add_lot(v_space, v_item.ingredient_id, v_item.buy_quantity, v_item.unit, null, 'PURCHASE', v_item.id);
    end if;
    update public.shopping_items as i
    set purchased_at = now(), purchased_by = auth.uid(), inventory_lot_id = v_lot
    where i.id = p_item_id;
  else
    if v_item.purchased_at is null then
      return;
    end if;
    if v_item.inventory_lot_id is not null
       and exists (select 1 from public.inventory_items as l where l.id = v_item.inventory_lot_id) then
      perform private.inventory_set_lot(v_space, v_item.inventory_lot_id, 0, 'PURCHASE_UNDO');
    end if;
    update public.shopping_items as i
    set purchased_at = null, purchased_by = null, inventory_lot_id = null
    where i.id = p_item_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 買い物のカテゴリ順（spaceごと）
-- ---------------------------------------------------------------------------
-- p_categories: カテゴリの配列（先頭から順）
create function public.set_shopping_category_order(p_categories text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
begin
  if v_space is null then
    raise exception 'not a member of any couple space' using errcode = '42501';
  end if;
  if p_categories is null or cardinality(p_categories) > 10 then
    raise exception 'invalid categories' using errcode = '22023';
  end if;
  delete from public.shopping_category_orders as o where o.couple_space_id = v_space;
  insert into public.shopping_category_orders (couple_space_id, category, position)
  select v_space, c.category, c.ordinality::smallint
  from unnest(p_categories) with ordinality as c(category, ordinality);
exception
  when check_violation or unique_violation then
    raise exception 'invalid categories' using errcode = '22023';
end;
$$;

revoke all on function public.set_meal_set_sides(uuid, jsonb) from public, anon;
revoke all on function public.prepare_shopping_list(uuid, jsonb) from public, anon;
revoke all on function public.set_home_check(uuid, boolean) from public, anon;
revoke all on function public.add_shopping_item(uuid, uuid, text, text, numeric, text, text) from public, anon;
revoke all on function public.remove_shopping_item(uuid) from public, anon;
revoke all on function public.confirm_shopping_list(uuid) from public, anon;
revoke all on function public.set_purchased(uuid, boolean) from public, anon;
revoke all on function public.set_shopping_category_order(text[]) from public, anon;
grant execute on function public.set_meal_set_sides(uuid, jsonb) to authenticated;
grant execute on function public.prepare_shopping_list(uuid, jsonb) to authenticated;
grant execute on function public.set_home_check(uuid, boolean) to authenticated;
grant execute on function public.add_shopping_item(uuid, uuid, text, text, numeric, text, text) to authenticated;
grant execute on function public.remove_shopping_item(uuid) to authenticated;
grant execute on function public.confirm_shopping_list(uuid) to authenticated;
grant execute on function public.set_purchased(uuid, boolean) to authenticated;
grant execute on function public.set_shopping_category_order(text[]) to authenticated;

-- 2人の画面へ変更を届ける（買い物中の同時操作。RLSで購読者を制限する）
alter publication supabase_realtime add table public.shopping_items, public.shopping_lists;
