-- Gate 4: 在庫（lot単位）と補正の監査
--
-- 方針（docs/database.md「在庫」）:
--   * 在庫はCoupleSpace共有。材料（ingredients）ごとに購入単位のlotを持ち、購入日から「そろそろ使いたい」を算出する（アプリ側）。
--   * 数量は0以上。互換単位（質量どうし・体積どうし・同じ個数単位）だけを換算して、古いlotから減算する。
--     換算できない単位のlotは減らさず、減らせなかった量を呼び出し元へ返す（推測で混ぜない）。
--   * 数量を変える操作はすべて監査（inventory_adjustments）へ、変更前後の量・理由・実行者を残す。同じtransactionで行う。
--   * 利用者は在庫表・監査表を読むだけ。書き込みは private schema の内部関数（SECURITY DEFINER、spaceを明示）に集約し、
--     利用者が直接呼べる入口は「手入力の追加」「手動補正」だけ（理由は関数が決める）。購入済み・作った・家にあるチェックは
--     それぞれの処理（Gate 6 / 7）の関数だけが内部関数を呼ぶ（理由の偽装・監査を通らない変更を防ぐ）。
--   * 単位の定義は lib/units/index.ts と同じ。変更時は両方を直す。

-- ---------------------------------------------------------------------------
-- 単位の換算（lib/units と同じ定義）
-- ---------------------------------------------------------------------------
-- 戻り値: grp = 'mass' | 'volume' | 'count:<単位>' | 'other:<表記>' | 'none'、factor = 基準単位（g / ml / 個数）への係数
create function private.unit_base(p_unit text)
returns table (grp text, factor numeric)
language sql
immutable
set search_path = ''
as $$
  select
    case
      when p_unit is null or btrim(p_unit) = '' then 'none'
      when p_unit in ('g', 'kg') then 'mass'
      when p_unit in ('ml', 'L', '大さじ', '小さじ', 'カップ', '合') then 'volume'
      when p_unit in ('個', '本', '枚', '束', '袋', 'パック', '玉', '株', '切れ', '片', '尾', '缶', '丁', '房', '粒', '箱', '瓶', '杯')
        then 'count:' || p_unit
      else 'other:' || btrim(p_unit)
    end,
    case p_unit
      when 'kg' then 1000::numeric
      when 'L' then 1000::numeric
      when '大さじ' then 15::numeric
      when '小さじ' then 5::numeric
      when 'カップ' then 200::numeric
      when '合' then 180::numeric
      else 1::numeric
    end
$$;

grant execute on function private.unit_base(text) to authenticated;

-- ---------------------------------------------------------------------------
-- inventory_items（lot）
-- ---------------------------------------------------------------------------
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null default private.current_couple_space_id(),
  ingredient_id uuid not null,
  quantity numeric(10, 2) not null constraint inventory_items_quantity_nonnegative check (quantity >= 0),
  unit text constraint inventory_items_unit_length check (unit is null or char_length(unit) between 1 and 20),
  purchased_on date not null default ((now() at time zone 'Asia/Tokyo')::date),
  -- 購入済みにした買い物項目（Gate 6）。同じ項目から二重に在庫を作らない
  source_shopping_item_id uuid constraint inventory_items_source_shopping_item_key unique,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint inventory_items_ingredient_fkey foreign key (ingredient_id, couple_space_id)
    references public.ingredients (id, couple_space_id) on delete cascade
);

comment on table public.inventory_items is '在庫のlot（CoupleSpace共有）。数量0になったlotは削除する（履歴は inventory_adjustments）';

create index inventory_items_space_ingredient_idx on public.inventory_items (couple_space_id, ingredient_id, purchased_on);

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory_adjustments（監査）
-- ---------------------------------------------------------------------------
create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null default private.current_couple_space_id()
    references public.couple_spaces (id) on delete cascade,
  ingredient_id uuid not null,
  inventory_item_id uuid,
  quantity_before numeric(10, 2) not null,
  quantity_after numeric(10, 2) not null,
  unit text,
  reason text not null constraint inventory_adjustments_reason_check check (
    reason in ('MANUAL_ADD', 'MANUAL_EDIT', 'MANUAL_REMOVE', 'PURCHASE', 'PURCHASE_UNDO', 'COOKED', 'HOME_CHECK')
  ),
  actor_id uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint inventory_adjustments_ingredient_fkey foreign key (ingredient_id, couple_space_id)
    references public.ingredients (id, couple_space_id) on delete cascade
);

comment on table public.inventory_adjustments is '在庫数量の変更履歴（変更前後・理由・実行者）。在庫関数だけが書き込む';

create index inventory_adjustments_space_created_idx on public.inventory_adjustments (couple_space_id, created_at desc);

-- ---------------------------------------------------------------------------
-- grants / RLS（利用者は読むだけ）
-- ---------------------------------------------------------------------------
revoke all on table public.inventory_items, public.inventory_adjustments from anon, authenticated;
grant select on table public.inventory_items to authenticated;
grant select on table public.inventory_adjustments to authenticated;

alter table public.inventory_items enable row level security;
alter table public.inventory_adjustments enable row level security;

create policy inventory_items_select_same_space on public.inventory_items
  for select to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));

create policy inventory_adjustments_select_same_space on public.inventory_adjustments
  for select to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));

-- ---------------------------------------------------------------------------
-- 内部関数（private。利用者は直接呼べない。呼び出し元の関数がspaceと理由を決めて渡す）
-- ---------------------------------------------------------------------------
create function private.inventory_add_lot(
  p_space uuid,
  p_ingredient_id uuid,
  p_quantity numeric,
  p_unit text,
  p_purchased_on date,
  p_reason text,
  p_source_shopping_item_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 99999 then
    raise exception 'quantity must be positive' using errcode = '22023';
  end if;
  -- 材料が同じspaceのものであることは複合外部キーで保証される
  insert into public.inventory_items (couple_space_id, ingredient_id, quantity, unit, purchased_on, source_shopping_item_id)
  values (
    p_space,
    p_ingredient_id,
    round(p_quantity, 2),
    nullif(btrim(p_unit), ''),
    coalesce(p_purchased_on, (now() at time zone 'Asia/Tokyo')::date),
    p_source_shopping_item_id
  )
  returning id into v_id;

  insert into public.inventory_adjustments (couple_space_id, ingredient_id, inventory_item_id, quantity_before, quantity_after, unit, reason, actor_id)
  values (p_space, p_ingredient_id, v_id, 0, round(p_quantity, 2), nullif(btrim(p_unit), ''), p_reason, auth.uid());
  return v_id;
end;
$$;

create function private.inventory_set_lot(p_space uuid, p_item_id uuid, p_quantity numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items;
  v_quantity numeric := round(p_quantity, 2);
begin
  if p_quantity is null or p_quantity < 0 or p_quantity > 99999 then
    raise exception 'quantity must be zero or positive' using errcode = '22023';
  end if;
  select * into v_item from public.inventory_items as i
  where i.id = p_item_id and i.couple_space_id = p_space
  for update;
  if not found then
    raise exception 'inventory item not found' using errcode = 'P0002';
  end if;

  if v_quantity = 0 then
    delete from public.inventory_items as i where i.id = p_item_id;
  else
    update public.inventory_items as i set quantity = v_quantity where i.id = p_item_id;
  end if;

  insert into public.inventory_adjustments (couple_space_id, ingredient_id, inventory_item_id, quantity_before, quantity_after, unit, reason, actor_id)
  values (p_space, v_item.ingredient_id, case when v_quantity = 0 then null else p_item_id end, v_item.quantity, v_quantity, v_item.unit, p_reason, auth.uid());
end;
$$;

-- 互換単位のlotだけを古い順に減らし、減らせなかった量（p_unit単位、小数2桁）を返す。
-- lotは小数2桁で保存するため、実際に減った量（丸め後の差）で残りを計算する
create function private.inventory_consume(p_space uuid, p_ingredient_id uuid, p_quantity numeric, p_unit text, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_need_grp text;
  v_need_factor numeric;
  v_remaining numeric;   -- 基準単位での残り
  v_lot record;
  v_new_quantity numeric;
  v_taken numeric;       -- 実際に減った量（基準単位）
begin
  if p_quantity is null or p_quantity <= 0 then
    return 0;
  end if;
  -- 単位なしの数量（例：卵 2）は、単位なしのlotとだけ合わせる（grp = 'none' どうし）
  select b.grp, b.factor into v_need_grp, v_need_factor from private.unit_base(p_unit) as b;
  v_remaining := p_quantity * v_need_factor;

  for v_lot in
    select i.id, i.quantity, i.unit, b.factor
    from public.inventory_items as i
    cross join lateral private.unit_base(i.unit) as b
    where i.couple_space_id = p_space
      and i.ingredient_id = p_ingredient_id
      and b.grp = v_need_grp
    order by i.purchased_on, i.created_at, i.id
    for update of i
  loop
    exit when v_remaining <= 0;
    v_new_quantity := greatest(round((v_lot.quantity * v_lot.factor - v_remaining) / v_lot.factor, 2), 0);
    v_taken := (v_lot.quantity - v_new_quantity) * v_lot.factor;
    if v_new_quantity = 0 then
      delete from public.inventory_items as i where i.id = v_lot.id;
    else
      update public.inventory_items as i set quantity = v_new_quantity where i.id = v_lot.id;
    end if;
    insert into public.inventory_adjustments (couple_space_id, ingredient_id, inventory_item_id, quantity_before, quantity_after, unit, reason, actor_id)
    values (p_space, p_ingredient_id, case when v_new_quantity = 0 then null else v_lot.id end, v_lot.quantity, v_new_quantity, v_lot.unit, p_reason, auth.uid());
    v_remaining := v_remaining - v_taken;
  end loop;

  return round(greatest(v_remaining, 0) / v_need_factor, 2);
end;
$$;

revoke all on function private.inventory_add_lot(uuid, uuid, numeric, text, date, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.inventory_set_lot(uuid, uuid, numeric, text) from public, anon, authenticated, service_role;
revoke all on function private.inventory_consume(uuid, uuid, numeric, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 利用者が呼べる入口（手入力の追加・手動補正）。理由は関数が決める
-- ---------------------------------------------------------------------------
create function public.inventory_add(p_ingredient_id uuid, p_quantity numeric, p_unit text, p_purchased_on date default null)
returns uuid
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
  if p_purchased_on > (now() at time zone 'Asia/Tokyo')::date then
    raise exception 'purchased date must not be in the future' using errcode = '22023';
  end if;
  return private.inventory_add_lot(v_space, p_ingredient_id, p_quantity, p_unit, p_purchased_on, 'MANUAL_ADD', null);
exception
  when foreign_key_violation then
    raise exception 'ingredient not found in this couple space' using errcode = '23503';
end;
$$;

create function public.inventory_set_quantity(p_item_id uuid, p_quantity numeric)
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
  perform private.inventory_set_lot(
    v_space,
    p_item_id,
    p_quantity,
    case when round(p_quantity, 2) = 0 then 'MANUAL_REMOVE' else 'MANUAL_EDIT' end
  );
end;
$$;

revoke all on function public.inventory_add(uuid, numeric, text, date) from public, anon;
revoke all on function public.inventory_set_quantity(uuid, numeric) from public, anon;
grant execute on function public.inventory_add(uuid, numeric, text, date) to authenticated;
grant execute on function public.inventory_set_quantity(uuid, numeric) to authenticated;

-- 2人の画面へ在庫の変更を届ける（Realtime。RLSで購読者を制限する）
alter publication supabase_realtime add table public.inventory_items;
