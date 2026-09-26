-- Gate 5: 週間計画（10候補・スワイプの判断・5品の確定）と調理履歴
--
-- 方針（docs/database.md「週間献立」「整合性と同時実行」、docs/recommendation.md）:
--   * 週は日本時間の月曜始まり。(couple_space_id, week_start) は一意で、同じ週の計画は2つ作れない。
--   * 候補は推薦の実行（recommendation_runs）ごとに保存し、algorithm_version・入力の要約・内訳を残す（説明可能・再現可能）。
--   * 確定は confirm_weekly_plan で1 transaction。version による楽観ロックで古い画面からの二重確定を拒否する。
--   * 主菜ごとの献立セット（meal_sets）に主菜・副菜・汁物を持つ（設計案の weekly_main_dishes は meal_sets に統合した）。
--   * 調理履歴（recipe_histories）は推薦の「未調理」「最近作った」に使う。書き込みはGate 7の「作った」処理が行う。

-- ---------------------------------------------------------------------------
-- weekly_plans
-- ---------------------------------------------------------------------------
create table public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null default private.current_couple_space_id()
    references public.couple_spaces (id) on delete cascade,
  week_start date not null constraint weekly_plans_week_start_monday check (extract(isodow from week_start) = 1),
  status text not null default 'DRAFT' constraint weekly_plans_status_check check (status in ('DRAFT', 'CONFIRMED', 'COMPLETED')),
  confirmed_at timestamp with time zone,
  confirmed_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint weekly_plans_space_week_key unique (couple_space_id, week_start),
  constraint weekly_plans_id_space_key unique (id, couple_space_id)
);

create trigger weekly_plans_set_updated_at
  before update on public.weekly_plans
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- recommendation_runs / recommendation_candidates
-- ---------------------------------------------------------------------------
create table public.recommendation_runs (
  id uuid primary key default gen_random_uuid(),
  weekly_plan_id uuid not null,
  couple_space_id uuid not null default private.current_couple_space_id(),
  algorithm_version text not null constraint recommendation_runs_version_length check (char_length(algorithm_version) between 1 and 40),
  -- 推薦の入力の要約（対象レシピ数・在庫の材料数など。個人情報は入れない）
  input_snapshot jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  generated_by uuid default auth.uid() references auth.users (id) on delete set null,
  generated_at timestamp with time zone not null default now(),
  constraint recommendation_runs_plan_fkey foreign key (weekly_plan_id, couple_space_id)
    references public.weekly_plans (id, couple_space_id) on delete cascade,
  constraint recommendation_runs_id_space_key unique (id, couple_space_id)
);

create index recommendation_runs_plan_idx on public.recommendation_runs (weekly_plan_id, generated_at desc);

create table public.recommendation_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  couple_space_id uuid not null default private.current_couple_space_id(),
  recipe_id uuid not null,
  position smallint not null constraint recommendation_candidates_position_range check (position between 1 and 60),
  score numeric(7, 2) not null default 0,
  score_breakdown jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  -- 手動追加（レシピ一覧から。もう作らない料理も手動なら追加できる）
  manual boolean not null default false,
  decision text not null default 'PENDING' constraint recommendation_candidates_decision_check check (decision in ('PENDING', 'ACCEPTED', 'SKIPPED')),
  decided_at timestamp with time zone,
  decided_by uuid references auth.users (id) on delete set null,
  constraint recommendation_candidates_run_fkey foreign key (run_id, couple_space_id)
    references public.recommendation_runs (id, couple_space_id) on delete cascade,
  constraint recommendation_candidates_recipe_fkey foreign key (recipe_id, couple_space_id)
    references public.recipes (id, couple_space_id),
  constraint recommendation_candidates_run_position_key unique (run_id, position),
  constraint recommendation_candidates_run_recipe_key unique (run_id, recipe_id)
);

-- ---------------------------------------------------------------------------
-- meal_sets（1主菜 = 1献立セット）
-- ---------------------------------------------------------------------------
create table public.meal_sets (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null default private.current_couple_space_id(),
  weekly_plan_id uuid not null,
  position smallint not null constraint meal_sets_position_range check (position between 1 and 7),
  main_recipe_id uuid not null,
  side_recipe_id uuid,
  soup_recipe_id uuid,
  -- 作る人数（材料の合算・栄養の計算に使う。2人分が既定）
  servings smallint not null default 2 constraint meal_sets_servings_range check (servings between 1 and 8),
  status text not null default 'PLANNED' constraint meal_sets_status_check check (status in ('PLANNED', 'COOKED')),
  cooked_at timestamp with time zone,
  version integer not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint meal_sets_plan_fkey foreign key (weekly_plan_id, couple_space_id)
    references public.weekly_plans (id, couple_space_id) on delete cascade,
  constraint meal_sets_main_fkey foreign key (main_recipe_id, couple_space_id) references public.recipes (id, couple_space_id),
  constraint meal_sets_side_fkey foreign key (side_recipe_id, couple_space_id) references public.recipes (id, couple_space_id),
  constraint meal_sets_soup_fkey foreign key (soup_recipe_id, couple_space_id) references public.recipes (id, couple_space_id),
  constraint meal_sets_plan_position_key unique (weekly_plan_id, position),
  constraint meal_sets_plan_main_key unique (weekly_plan_id, main_recipe_id),
  constraint meal_sets_id_space_key unique (id, couple_space_id)
);

create trigger meal_sets_set_updated_at
  before update on public.meal_sets
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- recipe_histories（作った記録。推薦の「未調理」「最近作った」）
-- ---------------------------------------------------------------------------
create table public.recipe_histories (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null default private.current_couple_space_id(),
  recipe_id uuid not null,
  cooked_on date not null,
  cooked_by uuid references auth.users (id) on delete set null,
  meal_set_id uuid,
  created_at timestamp with time zone not null default now(),
  constraint recipe_histories_recipe_fkey foreign key (recipe_id, couple_space_id)
    references public.recipes (id, couple_space_id) on delete cascade,
  constraint recipe_histories_meal_set_fkey foreign key (meal_set_id, couple_space_id)
    references public.meal_sets (id, couple_space_id) on delete set null (meal_set_id)
);

create index recipe_histories_recipe_idx on public.recipe_histories (couple_space_id, recipe_id, cooked_on desc);

-- ---------------------------------------------------------------------------
-- grants / RLS
-- ---------------------------------------------------------------------------
revoke all on table public.weekly_plans, public.recommendation_runs, public.recommendation_candidates,
  public.meal_sets, public.recipe_histories from anon, authenticated;

-- 計画・推薦結果・判断・献立セットの書き込みは下の関数（SECURITY DEFINER、関数内で自分のspaceかを確かめる）だけで行う。
-- 判断と確定はどちらも計画行をロックし、判断のたびに version を進める（確定と判断の競合・古い画面からの確定を防ぐ）
grant select on table public.weekly_plans to authenticated;
grant select on table public.recommendation_runs to authenticated;
grant select on table public.recommendation_candidates to authenticated;
grant select on table public.meal_sets to authenticated;
grant select on table public.recipe_histories to authenticated;

alter table public.weekly_plans enable row level security;
alter table public.recommendation_runs enable row level security;
alter table public.recommendation_candidates enable row level security;
alter table public.meal_sets enable row level security;
alter table public.recipe_histories enable row level security;

create policy weekly_plans_same_space on public.weekly_plans
  for all to authenticated
  using (couple_space_id = (select private.current_couple_space_id()))
  with check (couple_space_id = (select private.current_couple_space_id()));
create policy recommendation_runs_same_space on public.recommendation_runs
  for all to authenticated
  using (couple_space_id = (select private.current_couple_space_id()))
  with check (couple_space_id = (select private.current_couple_space_id()));
create policy recommendation_candidates_same_space on public.recommendation_candidates
  for all to authenticated
  using (couple_space_id = (select private.current_couple_space_id()))
  with check (couple_space_id = (select private.current_couple_space_id()));
create policy meal_sets_same_space on public.meal_sets
  for all to authenticated
  using (couple_space_id = (select private.current_couple_space_id()))
  with check (couple_space_id = (select private.current_couple_space_id()));
create policy recipe_histories_same_space on public.recipe_histories
  for all to authenticated
  using (couple_space_id = (select private.current_couple_space_id()))
  with check (couple_space_id = (select private.current_couple_space_id()));

-- ---------------------------------------------------------------------------
-- 週の計画を用意する（無ければ作る。同時に2人が開いても1つだけ）
-- ---------------------------------------------------------------------------
create function public.ensure_weekly_plan(p_week_start date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_id uuid;
begin
  if v_space is null then
    raise exception 'not a member of any couple space' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'week_start must be a Monday' using errcode = '22023';
  end if;
  insert into public.weekly_plans (couple_space_id, week_start) values (v_space, p_week_start)
  on conflict (couple_space_id, week_start) do nothing;
  select p.id into v_id from public.weekly_plans as p
  where p.week_start = p_week_start and p.couple_space_id = v_space;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 推薦の結果を保存する（アプリのサーバーが lib/recommendation で計算した10件）。DRAFTの計画だけ
-- ---------------------------------------------------------------------------
-- p_candidates: [{ recipe_id, score, breakdown, notes, manual }]（配列の順が表示順）
create function public.save_recommendation_run(
  p_plan_id uuid,
  p_algorithm_version text,
  p_input_snapshot jsonb,
  p_notes jsonb,
  p_candidates jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.weekly_plans;
  v_run uuid;
begin
  select * into v_plan from public.weekly_plans as p
  where p.id = p_plan_id and p.couple_space_id = private.current_couple_space_id()
  for update;
  if not found then
    raise exception 'weekly plan not found' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'DRAFT' then
    raise exception 'weekly plan is already confirmed' using errcode = '55000';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) > 60 then
    raise exception 'invalid candidates' using errcode = '22023';
  end if;

  -- 候補が入れ替わるため版を進める（古い画面からの確定・判断を拒否する）
  update public.weekly_plans as p set version = p.version + 1 where p.id = p_plan_id;

  insert into public.recommendation_runs (weekly_plan_id, couple_space_id, algorithm_version, input_snapshot, notes, generated_by)
  values (p_plan_id, v_plan.couple_space_id, p_algorithm_version, coalesce(p_input_snapshot, '{}'::jsonb), coalesce(p_notes, '[]'::jsonb), auth.uid())
  returning id into v_run;

  -- recipe_idは複合外部キーで同じspaceのレシピに限られる
  insert into public.recommendation_candidates (run_id, couple_space_id, recipe_id, position, score, score_breakdown, notes, manual)
  select v_run,
         v_plan.couple_space_id,
         (c.value ->> 'recipe_id')::uuid,
         c.ordinality::smallint,
         coalesce((c.value ->> 'score')::numeric, 0),
         coalesce(c.value -> 'breakdown', '[]'::jsonb),
         coalesce(c.value -> 'notes', '[]'::jsonb),
         coalesce((c.value ->> 'manual')::boolean, false)
  from jsonb_array_elements(p_candidates) with ordinality as c;
  return v_run;
exception
  when invalid_text_representation or datatype_mismatch then
    raise exception 'invalid candidates' using errcode = '22023';
  when foreign_key_violation then
    raise exception 'recipe not found in this couple space' using errcode = '23503';
end;
$$;

-- ---------------------------------------------------------------------------
-- 候補にレシピを手動で追加する（候補にない料理・もう作らない料理も、手動なら追加できる）
-- ---------------------------------------------------------------------------
create function public.add_manual_candidate(p_run_id uuid, p_recipe_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.recommendation_runs;
  v_status text;
  v_id uuid;
begin
  select * into v_run from public.recommendation_runs as r
  where r.id = p_run_id and r.couple_space_id = private.current_couple_space_id();
  if not found then
    raise exception 'recommendation run not found' using errcode = 'P0002';
  end if;
  select p.status into v_status from public.weekly_plans as p where p.id = v_run.weekly_plan_id for update;
  if v_status <> 'DRAFT' then
    raise exception 'weekly plan is already confirmed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.recommendation_runs as r
    where r.weekly_plan_id = v_run.weekly_plan_id and (r.generated_at, r.id) > (v_run.generated_at, v_run.id)
  ) then
    raise exception 'recommendation run is outdated' using errcode = '40001';
  end if;
  update public.weekly_plans as p set version = p.version + 1 where p.id = v_run.weekly_plan_id;

  select c.id into v_id from public.recommendation_candidates as c where c.run_id = p_run_id and c.recipe_id = p_recipe_id;
  if v_id is not null then
    update public.recommendation_candidates as c
    set decision = 'ACCEPTED', decided_at = now(), decided_by = auth.uid()
    where c.id = v_id;
    return v_id;
  end if;

  insert into public.recommendation_candidates (run_id, couple_space_id, recipe_id, position, manual, decision, decided_at, decided_by, notes)
  values (
    p_run_id,
    v_run.couple_space_id,
    p_recipe_id,
    (select coalesce(max(c.position), 0) + 1 from public.recommendation_candidates as c where c.run_id = p_run_id),
    true,
    'ACCEPTED',
    now(),
    auth.uid(),
    '["レシピ一覧から手動で追加"]'::jsonb
  )
  returning id into v_id;
  return v_id;
exception
  when foreign_key_violation then
    raise exception 'recipe not found in this couple space' using errcode = '23503';
end;
$$;

-- ---------------------------------------------------------------------------
-- 候補の判断（作る / スキップ / 未判断へ戻す）
-- ---------------------------------------------------------------------------
create function public.decide_candidate(p_candidate_id uuid, p_decision text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid := private.current_couple_space_id();
  v_candidate public.recommendation_candidates;
  v_run public.recommendation_runs;
  v_plan public.weekly_plans;
  v_latest uuid;
begin
  if p_decision not in ('PENDING', 'ACCEPTED', 'SKIPPED') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  select * into v_candidate from public.recommendation_candidates as c
  where c.id = p_candidate_id and c.couple_space_id = v_space;
  if not found then
    raise exception 'candidate not found' using errcode = 'P0002';
  end if;
  select * into v_run from public.recommendation_runs as r where r.id = v_candidate.run_id;
  -- 確定と同じ計画行のロックで直列化する
  select * into v_plan from public.weekly_plans as p where p.id = v_run.weekly_plan_id for update;
  if v_plan.status <> 'DRAFT' then
    raise exception 'weekly plan is already confirmed' using errcode = '55000';
  end if;
  select r.id into v_latest from public.recommendation_runs as r
  where r.weekly_plan_id = v_plan.id order by r.generated_at desc, r.id desc limit 1;
  if v_latest <> v_run.id then
    raise exception 'candidate belongs to an old recommendation' using errcode = '40001';
  end if;

  update public.recommendation_candidates as c
  set decision = p_decision,
      decided_at = case when p_decision = 'PENDING' then null else now() end,
      decided_by = case when p_decision = 'PENDING' then null else auth.uid() end
  where c.id = p_candidate_id;
  update public.weekly_plans as p set version = p.version + 1 where p.id = v_plan.id;
  return v_plan.version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5品を確定する（1 transaction・楽観ロック・冪等）
-- ---------------------------------------------------------------------------
-- 確定する主菜は、最新の推薦runで「作る」を選んだ候補（ちょうど5品）。判断の順に並べる。
-- 戻り値: 確定後の version。既に確定済みなら何もせず現在の version を返す（二重送信・相手が先に確定した場合）
create function public.confirm_weekly_plan(p_plan_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.weekly_plans;
  v_run uuid;
  v_count integer;
begin
  select * into v_plan from public.weekly_plans as p
  where p.id = p_plan_id and p.couple_space_id = private.current_couple_space_id()
  for update;
  if not found then
    raise exception 'weekly plan not found' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'DRAFT' then
    return v_plan.version;
  end if;
  if v_plan.version <> p_expected_version then
    raise exception 'weekly plan was changed by someone else' using errcode = '40001';
  end if;

  select r.id into v_run from public.recommendation_runs as r
  where r.weekly_plan_id = p_plan_id order by r.generated_at desc, r.id desc limit 1;
  select count(*) into v_count from public.recommendation_candidates as c where c.run_id = v_run and c.decision = 'ACCEPTED';
  if v_count <> 5 then
    raise exception 'exactly 5 main dishes must be accepted (now %)', v_count using errcode = '22023';
  end if;

  insert into public.meal_sets (weekly_plan_id, couple_space_id, position, main_recipe_id)
  select p_plan_id, v_plan.couple_space_id, row_number() over (order by c.decided_at, c.position)::smallint, c.recipe_id
  from public.recommendation_candidates as c
  where c.run_id = v_run and c.decision = 'ACCEPTED';

  update public.weekly_plans as p
  set status = 'CONFIRMED', confirmed_at = now(), confirmed_by = auth.uid(), version = p.version + 1
  where p.id = p_plan_id;
  return v_plan.version + 1;
end;
$$;

revoke all on function public.ensure_weekly_plan(date) from public, anon;
revoke all on function public.save_recommendation_run(uuid, text, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.confirm_weekly_plan(uuid, integer) from public, anon;
revoke all on function public.decide_candidate(uuid, text) from public, anon;
grant execute on function public.decide_candidate(uuid, text) to authenticated;
revoke all on function public.add_manual_candidate(uuid, uuid) from public, anon;
grant execute on function public.add_manual_candidate(uuid, uuid) to authenticated;
grant execute on function public.ensure_weekly_plan(date) to authenticated;
grant execute on function public.save_recommendation_run(uuid, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.confirm_weekly_plan(uuid, integer) to authenticated;

-- 2人の画面へ変更を届ける（Realtime。RLSで購読者を制限する）
alter publication supabase_realtime add table public.weekly_plans, public.recommendation_candidates, public.meal_sets;
