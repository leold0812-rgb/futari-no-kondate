-- Gate 7: 日常利用（作った・食事履歴・ご飯量・副菜/汁物の差し替え・余裕日）
--
-- 方針（docs/product-spec.md 平日、docs/database.md 整合性と同時実行）:
--   * 「作った」は1回の操作で、食事履歴・調理履歴・在庫の減算・献立セットの状態を1 transactionで保存する。
--     idempotency_key（画面ごとの一意値）で二重送信・2人の同時操作でも1回だけ処理する。
--   * 在庫の減算は Gate 4 の内部関数（互換単位だけ・古い順・減らせない分は減らさない）を使い、理由は COOKED。
--   * 副菜・汁物の差し替えは meal_sets.version による楽観ロックで、古い画面からの上書きを拒否する。
--   * ご飯量は個人設定（本人だけが変更）だが、献立画面で相手の量も表示できる（同じspaceで読める）。
--   * 食事履歴の栄養は、作った時点のレシピの値と各自のご飯量の写し（あとでレシピを直しても履歴は変わらない）。
--     値はDB内（private.meal_nutrition）で算出し、クライアントからは受け取らない。余裕日も2人分に固定する。

-- ---------------------------------------------------------------------------
-- rice_portions（ご飯量、個人）
-- ---------------------------------------------------------------------------
create table public.rice_portions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  couple_space_id uuid not null default private.current_couple_space_id()
    references public.couple_spaces (id) on delete cascade,
  grams smallint not null constraint rice_portions_grams_range check (grams between 0 and 600),
  updated_at timestamp with time zone not null default now()
);

create trigger rice_portions_set_updated_at
  before update on public.rice_portions
  for each row execute function private.set_updated_at();

revoke all on table public.rice_portions from anon, authenticated;
grant select, insert, update on table public.rice_portions to authenticated;
alter table public.rice_portions enable row level security;

create policy rice_portions_select_same_space on public.rice_portions
  for select to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));
create policy rice_portions_insert_own on public.rice_portions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and couple_space_id = (select private.current_couple_space_id()));
create policy rice_portions_update_own on public.rice_portions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and couple_space_id = (select private.current_couple_space_id()));

-- ---------------------------------------------------------------------------
-- meal_histories（食事履歴）
-- ---------------------------------------------------------------------------
create table public.meal_histories (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null references public.couple_spaces (id) on delete cascade,
  meal_set_id uuid,
  eaten_on date not null,
  completed_by uuid references auth.users (id) on delete set null,
  idempotency_key text not null constraint meal_histories_idempotency_key_length check (char_length(idempotency_key) between 8 and 80),
  -- 料理名（主菜・副菜・汁物）の写し
  dishes jsonb not null default '[]'::jsonb,
  -- 各自の栄養の写し { "<user_id>": { energyKcal, proteinG, fatG, carbsG, riceGrams, complete } }
  nutrition_per_person jsonb not null default '{}'::jsonb,
  -- 在庫で減らせなかった材料（換算できない単位・在庫不足）
  unconsumed jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint meal_histories_idempotency_key_key unique (couple_space_id, idempotency_key),
  constraint meal_histories_meal_set_fkey foreign key (meal_set_id, couple_space_id)
    references public.meal_sets (id, couple_space_id) on delete set null (meal_set_id),
  constraint meal_histories_id_space_key unique (id, couple_space_id)
);

create index meal_histories_space_eaten_idx on public.meal_histories (couple_space_id, eaten_on desc);

revoke all on table public.meal_histories from anon, authenticated;
grant select on table public.meal_histories to authenticated;
alter table public.meal_histories enable row level security;
create policy meal_histories_select_same_space on public.meal_histories
  for select to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));

-- 調理履歴から食事履歴へ（どの「作った」で記録したか）
alter table public.recipe_histories add column meal_history_id uuid;
alter table public.recipe_histories
  add constraint recipe_histories_meal_history_fkey foreign key (meal_history_id, couple_space_id)
    references public.meal_histories (id, couple_space_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 内部：1品分の材料を在庫から減らす（人数換算）。減らせなかった材料を返す
-- ---------------------------------------------------------------------------
create function private.consume_recipe(p_space uuid, p_recipe_id uuid, p_servings integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factor numeric;
  v_line record;
  v_left numeric;
  v_unconsumed jsonb := '[]'::jsonb;
begin
  select p_servings::numeric / greatest(r.servings, 1) into v_factor
  from public.recipes as r where r.id = p_recipe_id and r.couple_space_id = p_space;
  if v_factor is null then
    return v_unconsumed;
  end if;
  for v_line in
    select ri.ingredient_id, ri.raw_name, ri.unit, sum(ri.quantity) * v_factor as quantity
    from public.recipe_ingredients as ri
    where ri.recipe_id = p_recipe_id and ri.ingredient_id is not null and ri.quantity is not null
    group by ri.ingredient_id, ri.raw_name, ri.unit
    order by ri.ingredient_id, ri.unit
  loop
    v_left := private.inventory_consume(p_space, v_line.ingredient_id, v_line.quantity, v_line.unit, 'COOKED');
    if v_left > 0 then
      v_unconsumed := v_unconsumed || jsonb_build_object('name', v_line.raw_name, 'quantity', v_left, 'unit', v_line.unit);
    end if;
  end loop;
  return v_unconsumed;
end;
$$;

revoke all on function private.consume_recipe(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 内部：各自の栄養の写し（料理の1人前の値＋ご飯量）。クライアントの値は使わない
-- ---------------------------------------------------------------------------
-- 戻り値: { "<user_id>": { energyKcal, proteinG, fatG, carbsG, riceGrams, complete, missing } }
-- ご飯の栄養はGate 2b（食品成分表）で加算する。それまでは、ご飯を食べる人は complete=false（missing に「ご飯」）
create function private.meal_nutrition(p_space uuid, p_recipe_ids uuid[])
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
  )
  select coalesce(jsonb_object_agg(
    p.id::text,
    jsonb_build_object(
      'energyKcal', round(t.energy),
      'proteinG', round(t.protein, 1),
      'fatG', round(t.fat, 1),
      'carbsG', round(t.carbs, 1),
      'riceGrams', coalesce(rp.grams, 0),
      'missing', t.missing || case when coalesce(rp.grams, 0) > 0 then '["ご飯"]'::jsonb else '[]'::jsonb end,
      'complete', jsonb_array_length(t.missing) = 0 and coalesce(rp.grams, 0) = 0
    )
  ), '{}'::jsonb)
  from public.profiles as p
  cross join totals as t
  left join public.rice_portions as rp on rp.user_id = p.id
  where p.couple_space_id = p_space
$$;

revoke all on function private.meal_nutrition(uuid, uuid[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 作った（献立セット）。1 transaction・冪等
-- ---------------------------------------------------------------------------
-- 戻り値: { meal_history_id, already, unconsumed, first_time_recipe_ids }
--   already = true なら同じ操作は処理済み（二重送信・相手が先に押した）で、何も変更していない
--   first_time_recipe_ids: 今回が初めての調理になったレシピ（初回評価を求める）
create function public.complete_meal_set(p_meal_set_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_set public.meal_sets;
  v_existing uuid;
  v_history uuid;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_recipes uuid[];
  v_first uuid[];
  v_unconsumed jsonb := '[]'::jsonb;
  v_recipe uuid;
begin
  if v_space is null then
    raise exception 'not a member of any couple space' using errcode = '42501';
  end if;
  select * into v_set from public.meal_sets as m where m.id = p_meal_set_id and m.couple_space_id = v_space for update;
  if not found then
    raise exception 'meal set not found' using errcode = 'P0002';
  end if;

  select h.id into v_existing from public.meal_histories as h
  where h.couple_space_id = v_space and (h.idempotency_key = p_idempotency_key or h.meal_set_id = p_meal_set_id)
  limit 1;
  if v_existing is not null or v_set.status = 'COOKED' then
    return jsonb_build_object('meal_history_id', v_existing, 'already', true, 'unconsumed', '[]'::jsonb, 'first_time_recipe_ids', '[]'::jsonb);
  end if;

  v_recipes := array_remove(array[v_set.main_recipe_id, v_set.side_recipe_id, v_set.soup_recipe_id], null);
  select coalesce(array_agg(r), '{}') into v_first
  from unnest(v_recipes) as r
  where not exists (select 1 from public.recipe_histories as h where h.recipe_id = r);

  insert into public.meal_histories (couple_space_id, meal_set_id, eaten_on, completed_by, idempotency_key, dishes, nutrition_per_person)
  values (
    v_space, p_meal_set_id, v_today, auth.uid(), p_idempotency_key,
    (select coalesce(jsonb_agg(jsonb_build_object('recipe_id', r.id, 'name', r.name, 'dish_type', r.dish_type)), '[]'::jsonb)
     from unnest(v_recipes) with ordinality as u(id, ord) join public.recipes as r on r.id = u.id),
    private.meal_nutrition(v_space, v_recipes)
  )
  returning id into v_history;

  foreach v_recipe in array v_recipes loop
    insert into public.recipe_histories (couple_space_id, recipe_id, cooked_on, cooked_by, meal_set_id, meal_history_id)
    values (v_space, v_recipe, v_today, auth.uid(), p_meal_set_id, v_history);
    v_unconsumed := v_unconsumed || private.consume_recipe(v_space, v_recipe, v_set.servings);
  end loop;

  update public.meal_histories as h set unconsumed = v_unconsumed where h.id = v_history;
  update public.meal_sets as m set status = 'COOKED', cooked_at = now(), version = m.version + 1 where m.id = p_meal_set_id;
  -- 5つすべて作ったら週の計画を完了にする
  update public.weekly_plans as p set status = 'COMPLETED', version = p.version + 1
  where p.id = v_set.weekly_plan_id and p.status = 'CONFIRMED'
    and not exists (select 1 from public.meal_sets as m where m.weekly_plan_id = p.id and m.status = 'PLANNED');

  return jsonb_build_object(
    'meal_history_id', v_history, 'already', false, 'unconsumed', v_unconsumed, 'first_time_recipe_ids', to_jsonb(v_first)
  );
exception
  when unique_violation then
    -- 同時に押された場合（片方だけが処理される）
    return jsonb_build_object('meal_history_id', null, 'already', true, 'unconsumed', '[]'::jsonb, 'first_time_recipe_ids', '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 作った（余裕日：献立に無い料理）。1 transaction・冪等
-- ---------------------------------------------------------------------------
create function public.complete_free_meal(p_recipe_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_existing uuid;
  v_history uuid;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_first boolean;
  v_unconsumed jsonb;
begin
  if v_space is null then
    raise exception 'not a member of any couple space' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.recipes as r
    where r.id = p_recipe_id and r.couple_space_id = v_space and r.deleted_at is null and r.status = 'READY'
  ) then
    raise exception 'recipe not found' using errcode = 'P0002';
  end if;
  -- 同じ操作の二重送信を直列化する
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('meal:' || v_space::text || ':' || p_idempotency_key, 0));
  select h.id into v_existing from public.meal_histories as h where h.couple_space_id = v_space and h.idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('meal_history_id', v_existing, 'already', true, 'unconsumed', '[]'::jsonb, 'first_time_recipe_ids', '[]'::jsonb);
  end if;

  v_first := not exists (select 1 from public.recipe_histories as h where h.recipe_id = p_recipe_id);
  insert into public.meal_histories (couple_space_id, eaten_on, completed_by, idempotency_key, dishes, nutrition_per_person)
  select v_space, v_today, auth.uid(), p_idempotency_key,
         jsonb_build_array(jsonb_build_object('recipe_id', r.id, 'name', r.name, 'dish_type', r.dish_type)),
         private.meal_nutrition(v_space, array[p_recipe_id])
  from public.recipes as r where r.id = p_recipe_id
  returning id into v_history;

  insert into public.recipe_histories (couple_space_id, recipe_id, cooked_on, cooked_by, meal_history_id)
  values (v_space, p_recipe_id, v_today, auth.uid(), v_history);
  -- 2人専用のため、余裕日も2人分として在庫を減らす（人数を外から指定させない）
  v_unconsumed := private.consume_recipe(v_space, p_recipe_id, 2);
  update public.meal_histories as h set unconsumed = v_unconsumed where h.id = v_history;

  return jsonb_build_object(
    'meal_history_id', v_history, 'already', false, 'unconsumed', v_unconsumed,
    'first_time_recipe_ids', case when v_first then jsonb_build_array(p_recipe_id) else '[]'::jsonb end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 副菜・汁物の差し替え（楽観ロック）
-- ---------------------------------------------------------------------------
-- p_kind: 'SIDE' | 'SOUP'。p_recipe_id が null なら「なし」にする
create function public.swap_meal_set_dish(p_meal_set_id uuid, p_kind text, p_recipe_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_set public.meal_sets;
begin
  if p_kind not in ('SIDE', 'SOUP') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  select * into v_set from public.meal_sets as m where m.id = p_meal_set_id and m.couple_space_id = v_space for update;
  if not found then
    raise exception 'meal set not found' using errcode = 'P0002';
  end if;
  if v_set.status <> 'PLANNED' then
    raise exception 'meal set is already cooked' using errcode = '55000';
  end if;
  if v_set.version <> p_expected_version then
    raise exception 'meal set was changed by someone else' using errcode = '40001';
  end if;
  if p_recipe_id is not null and not exists (
    select 1 from public.recipes as r
    where r.id = p_recipe_id and r.couple_space_id = v_space and r.dish_type = p_kind and r.status = 'READY' and r.deleted_at is null
  ) then
    raise exception 'recipe cannot be used as this dish' using errcode = '23503';
  end if;

  update public.meal_sets as m
  set side_recipe_id = case when p_kind = 'SIDE' then p_recipe_id else m.side_recipe_id end,
      soup_recipe_id = case when p_kind = 'SOUP' then p_recipe_id else m.soup_recipe_id end,
      version = m.version + 1
  where m.id = p_meal_set_id;
  return v_set.version + 1;
end;
$$;

revoke all on function public.complete_meal_set(uuid, text) from public, anon;
revoke all on function public.complete_free_meal(uuid, text) from public, anon;
revoke all on function public.swap_meal_set_dish(uuid, text, uuid, integer) from public, anon;
grant execute on function public.complete_meal_set(uuid, text) to authenticated;
grant execute on function public.complete_free_meal(uuid, text) to authenticated;
grant execute on function public.swap_meal_set_dish(uuid, text, uuid, integer) to authenticated;

alter publication supabase_realtime add table public.meal_histories;
