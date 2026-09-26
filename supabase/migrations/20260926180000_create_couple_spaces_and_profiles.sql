-- Gate 1.1: CoupleSpace / profiles とRLS
--
-- 目的:
--   2人専用アプリの共有空間（couple_spaces）と、Auth利用者に紐づく最小プロフィール（profiles）を作る。
--   画面やログイン処理より先に、DBへ直接アクセスされても未認証者・別空間の利用者にはデータが見えない境界を作る。
--
-- 設計判断:
--   * profiles には認証情報（email・PIN・Auth metadata）を複製しない。表示名と所属space IDだけを持つ。
--   * 1 space あたり profile は最大2件。space行のFOR UPDATEロックで同時INSERTを直列化して守る。
--   * anon / authenticated へのgrantsを最小化した上でRLSも有効化する（grantsとRLSの二重で閉じる）。
--   * profile / space の作成・更新・削除は一般ユーザーへ許可しない。初期2人の登録は後続のbootstrap作業
--     （service role等の管理者操作）で行う。環境固有のUUID・email・名前はこのmigrationに書かない。
--   * RLSの所属判定は private schema の SECURITY DEFINER helper で行い、profiles への再帰参照を避ける。
--     private schema は PostgREST の exposed schemas に追加しない。
--   * `role` 列は今回追加しない（一般ユーザーが変更できないだけでなく、現時点で使う機能がないため）。

-- ---------------------------------------------------------------------------
-- private schema（RLS helper / trigger function 置き場。APIには公開しない）
-- ---------------------------------------------------------------------------
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
-- authenticated はRLS policy評価中にhelperを呼ぶため、USAGEのみ付与する（CREATE等は付与しない）
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- couple_spaces
-- ---------------------------------------------------------------------------
create table public.couple_spaces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table public.couple_spaces is '2人が共有するデータ領域。メンバー数は0〜2人（profilesで管理）';

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  -- auth.users.id と同一。1人のAuth利用者は最大1つのspaceにだけ所属する
  id uuid primary key references auth.users (id) on delete cascade,
  couple_space_id uuid not null references public.couple_spaces (id) on delete restrict,
  -- 共有画面で見せる名前だけを格納する（ユーザー選択画面用）。emailやPINは入れない
  display_name text not null
    constraint profiles_display_name_length check (char_length(btrim(display_name)) between 1 and 30),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table public.profiles is 'Auth利用者の最小プロフィール。認証情報は持たない';
comment on column public.profiles.display_name is '共有画面で表示する名前のみ。email・PIN・Auth metadataを格納しない';

-- 同じspace内で表示名が重複するとユーザー選択画面で区別できないため禁止する
create unique index profiles_couple_space_display_name_key
  on public.profiles (couple_space_id, btrim(display_name));

-- RLS helper が couple_space_id で引くほか、上限チェックのcountにも使う
create index profiles_couple_space_id_idx on public.profiles (couple_space_id);

-- ---------------------------------------------------------------------------
-- updated_at の自動更新
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create trigger couple_spaces_set_updated_at
  before update on public.couple_spaces
  for each row execute function private.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2人上限
-- ---------------------------------------------------------------------------
-- 対象spaceの行を FOR UPDATE でロックしてから件数を数える。同じspaceへの同時INSERT/移動は
-- このロックで直列化されるため、read committed でも後続transactionは先行分のcommit後に
-- 件数を数え直し、3人目は必ず拒否される。ロックは1行のみで、複数lockの順序によるdeadlockは起きない。
-- SECURITY DEFINER にするのは、呼び出し元roleのRLS/grantsに関係なく確実にロックと件数取得を行うため。
-- 一般ユーザーにはprofilesへのINSERT/UPDATE権限自体がなく、このtriggerは管理者操作にのみ発火する。
create function private.enforce_couple_space_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_count integer;
begin
  perform 1
  from public.couple_spaces as s
  where s.id = new.couple_space_id
  for update;

  select pg_catalog.count(*)
  into member_count
  from public.profiles as p
  where p.couple_space_id = new.couple_space_id
    and p.id <> new.id;

  if member_count >= 2 then
    raise exception 'couple_space % already has the maximum of 2 profiles', new.couple_space_id
      using errcode = 'check_violation',
            constraint = 'profiles_couple_space_member_limit';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_couple_space_member_limit() from public, anon, authenticated;

create trigger profiles_enforce_member_limit
  before insert or update of couple_space_id on public.profiles
  for each row execute function private.enforce_couple_space_member_limit();

-- ---------------------------------------------------------------------------
-- RLS helper: 呼び出し元が所属するspaceのID
-- ---------------------------------------------------------------------------
-- policyから profiles を直接参照すると再帰するため、SECURITY DEFINER で所属だけを返す。
-- search_path を空にし、全relationをschema修飾する。EXECUTE は authenticated のみ。
create function private.current_couple_space_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.couple_space_id
  from public.profiles as p
  where p.id = (select auth.uid())
$$;

revoke all on function private.current_couple_space_id() from public, anon;
grant execute on function private.current_couple_space_id() to authenticated;

-- ---------------------------------------------------------------------------
-- grants（Supabaseの既定privilegesがanon/authenticatedへ付与する権限を明示的に外してから最小限を付与）
-- ---------------------------------------------------------------------------
revoke all on table public.couple_spaces from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;

-- authenticated は読み取りのみ。profilesは最小列（ID・表示名・space ID）だけ。
-- created_at / updated_at は付与しないため、`select *` は権限エラーになる（列を明示すること）。
grant select (id, created_at) on public.couple_spaces to authenticated;
grant select (id, couple_space_id, display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.couple_spaces enable row level security;
alter table public.profiles enable row level security;

-- 自分が属するspaceだけ読める。INSERT/UPDATE/DELETE用のpolicyは作らない（grantsも無いため二重に拒否）。
create policy couple_spaces_select_own_space
  on public.couple_spaces
  for select
  to authenticated
  using (id = (select private.current_couple_space_id()));

-- 自分と同じspaceのprofileだけ読める（相手の表示名を見るため）。
create policy profiles_select_same_space
  on public.profiles
  for select
  to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));
