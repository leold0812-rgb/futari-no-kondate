-- Gate 1.1: CoupleSpace / profiles のgrants・RLS・2人上限のpolicy test
-- 実行: `npm run db:test`（`supabase test db`。ローカルDocker上のDBに対して実行する）
--
-- fixtureはすべてtransaction内の架空データで、最後にrollbackする。
-- email・PIN・実在の名前は使わない（auth.usersにはidだけを入れる）。

begin;

select plan(47);

-- ---------------------------------------------------------------------------
-- fixture（postgres権限）
--   sp1: user A, user B（2人・満員）
--   sp2: user D（1人）
--   user C: Auth利用者だが、どのspaceにも未所属
--   user E: 3人目追加の検証用（Auth利用者のみ・未所属）
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000d'),
  ('00000000-0000-4000-8000-00000000000e');

insert into public.couple_spaces (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');

-- 6. 2人目までの初期登録は許可される
select lives_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'fixture-a')$$,
  '1人目のprofile登録は許可される'
);
select lives_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'fixture-b')$$,
  '2人目のprofile登録は許可される'
);
select lives_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000002', 'fixture-d')$$,
  '別spaceの1人目のprofile登録は許可される'
);

-- 5. 3人目の追加は拒否され、既存の2人とspaceに変更がない
select throws_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000e', '10000000-0000-4000-8000-000000000001', 'fixture-e')$$,
  '23514',
  null,
  '3人目のprofile追加は拒否される'
);
select is(
  (select count(*)::int from public.profiles where couple_space_id = '10000000-0000-4000-8000-000000000001'),
  2,
  '3人目の拒否後もspaceのprofileは2件のまま'
);
select is(
  (select array_agg(id order by id) from public.profiles where couple_space_id = '10000000-0000-4000-8000-000000000001'),
  array['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b']::uuid[],
  '3人目の拒否後も既存の2人が変わっていない'
);
select is(
  (select count(*)::int from public.couple_spaces),
  2,
  '3人目の拒否後もspaceの件数は変わらない'
);
select throws_ok(
  $$update public.profiles set couple_space_id = '10000000-0000-4000-8000-000000000001'
    where id = '00000000-0000-4000-8000-00000000000d'$$,
  '23514',
  null,
  '満員のspaceへのprofile移動（管理者操作でも）は拒否される'
);
select is(
  (select couple_space_id from public.profiles where id = '00000000-0000-4000-8000-00000000000d'),
  '10000000-0000-4000-8000-000000000002'::uuid,
  '拒否された移動後もprofileの所属は元のまま'
);
select lives_ok(
  $$update public.profiles set couple_space_id = '10000000-0000-4000-8000-000000000002'
    where id = '00000000-0000-4000-8000-00000000000d'$$,
  '同じspaceへの再設定（上限に影響しない更新）は許可される'
);

-- 制約: 表示名の重複・空白のみは拒否
select throws_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000002', 'fixture-d')$$,
  '23505',
  null,
  '同じspace内の表示名重複は拒否される'
);
select throws_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000002', '   ')$$,
  '23514',
  null,
  '空白だけの表示名は拒否される'
);
select throws_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000099', 'fixture-c')$$,
  '23503',
  null,
  '存在しないspaceへのprofile登録は拒否される'
);
select throws_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-0000000000ff', '10000000-0000-4000-8000-000000000002', 'fixture-x')$$,
  '23503',
  null,
  'auth.usersに存在しないidのprofile登録は拒否される'
);

-- ---------------------------------------------------------------------------
-- 構造: RLS有効化・grants・helperの公開範囲
-- ---------------------------------------------------------------------------
select is(
  (select relrowsecurity from pg_class where oid = 'public.couple_spaces'::regclass),
  true,
  'couple_spacesはRLSが有効'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  true,
  'profilesはRLSが有効'
);
select is(
  (select count(*)::int
   from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as privilege
   where has_table_privilege('anon', 'public.couple_spaces', privilege)
      or has_table_privilege('anon', 'public.profiles', privilege)),
  0,
  'anonはcouple_spaces / profilesに一切のtable権限を持たない'
);
select is(
  (select count(*)::int
   from unnest(array['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as privilege
   where has_table_privilege('authenticated', 'public.couple_spaces', privilege)
      or has_table_privilege('authenticated', 'public.profiles', privilege)),
  0,
  'authenticatedは読み取り以外のtable権限を持たない'
);
select is(
  (select count(*)::int
   from pg_attribute a
   where a.attrelid = 'public.profiles'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and has_column_privilege('authenticated', 'public.profiles', a.attname, 'select')),
  3,
  'authenticatedがprofilesで読める列は3列だけ'
);
select is(
  has_column_privilege('authenticated', 'public.profiles', 'created_at', 'select')
    or has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'select'),
  false,
  'authenticatedはprofilesのcreated_at / updated_atを読めない'
);
select is(
  has_schema_privilege('anon', 'private', 'usage'),
  false,
  'anonはprivate schemaを使えない'
);
select is(
  has_function_privilege('anon', 'private.current_couple_space_id()', 'execute'),
  false,
  'anonはRLS helperを実行できない'
);
select is(
  has_function_privilege('authenticated', 'private.enforce_couple_space_member_limit()', 'execute')
    or has_function_privilege('authenticated', 'private.set_updated_at()', 'execute'),
  false,
  'authenticatedは上限triggerとupdated_at triggerの関数を実行できない'
);
select is(
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('current_couple_space_id', 'enforce_couple_space_member_limit', 'set_updated_at')),
  0,
  'helper / trigger functionはpublic schemaに存在しない'
);

-- ---------------------------------------------------------------------------
-- 1. anon
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok('select id from public.couple_spaces', '42501', null, 'anonはcouple_spacesを読めない');
select throws_ok('select id from public.profiles', '42501', null, 'anonはprofilesを読めない');
select throws_ok(
  $$insert into public.couple_spaces (id) values ('10000000-0000-4000-8000-0000000000aa')$$,
  '42501', null, 'anonはcouple_spacesへ書き込めない'
);
select throws_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000001', 'fixture-c')$$,
  '42501', null, 'anonはprofilesへ書き込めない'
);

reset role;

-- ---------------------------------------------------------------------------
-- 2. 同じspaceの認証済みユーザー（user A）
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select array_agg(id) from public.couple_spaces),
  array['10000000-0000-4000-8000-000000000001']::uuid[],
  'user Aは自分のspaceだけ読める（別spaceは見えない）'
);
select is(
  (select array_agg(id order by id) from public.profiles),
  array['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b']::uuid[],
  'user Aは同じspaceの2人のprofileだけ読める（別spaceのprofileは見えない）'
);
select is(
  (select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'fixture-b',
  'user Aは相手の表示名を読める'
);
select throws_ok('select * from public.profiles', '42501', null, 'profilesのselect *は最小列外を含むため拒否される');
select throws_ok('select created_at from public.profiles', '42501', null, 'profilesのcreated_atは読めない');
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-00000000000d'),
  0,
  'user Aは別spaceのprofileを直接指定しても読めない'
);

-- 4. profileの作成・削除・別spaceへの移動・更新は拒否
select throws_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000001', 'fixture-c')$$,
  '42501', null, 'user Aはprofileを作成できない'
);
select throws_ok(
  $$delete from public.profiles where id = '00000000-0000-4000-8000-00000000000b'$$,
  '42501', null, 'user Aは相手のprofileを削除できない'
);
select throws_ok(
  $$delete from public.profiles where id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'user Aは自分のprofileも削除できない'
);
select throws_ok(
  $$update public.profiles set couple_space_id = '10000000-0000-4000-8000-000000000002'
    where id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'user Aは自分のprofileを別spaceへ移動できない'
);
select throws_ok(
  $$update public.profiles set display_name = 'changed' where id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'user Aは自分のprofileの表示名も更新できない（今回は更新不可）'
);
select throws_ok(
  $$insert into public.couple_spaces (id) values ('10000000-0000-4000-8000-0000000000aa')$$,
  '42501', null, 'user Aはspaceを作成できない'
);
select throws_ok(
  $$delete from public.couple_spaces where id = '10000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'user Aはspaceを削除できない'
);

reset role;

-- ---------------------------------------------------------------------------
-- 別spaceのユーザー（user D）と3. 未所属ユーザー（user C）
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select array_agg(id) from public.couple_spaces),
  array['10000000-0000-4000-8000-000000000002']::uuid[],
  'user Dは自分のspaceだけ読める'
);
select is(
  (select array_agg(id) from public.profiles),
  array['00000000-0000-4000-8000-00000000000d']::uuid[],
  'user Dは別spaceのprofile（A・B）を読めない'
);

reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.couple_spaces), 0, '未所属のuser Cはどのspaceも読めない');
select is((select count(*)::int from public.profiles), 0, '未所属のuser Cはどのprofileも読めない');
select throws_ok(
  $$insert into public.profiles (id, couple_space_id, display_name)
    values ('00000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-000000000002', 'fixture-c')$$,
  '42501', null, '未所属のuser Cは自分をspaceへ登録できない'
);

reset role;

-- JWTのsubが無い（authenticatedだがsub無し）場合は何も読めない
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.profiles), 0, 'subの無いauthenticated tokenはprofileを読めない');

reset role;

select * from finish();

rollback;
