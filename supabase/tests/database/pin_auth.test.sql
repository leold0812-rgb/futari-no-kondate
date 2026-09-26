-- Gate 1.4: PINの保存と試行制限（public.pin_login_begin / pin_login_succeeded / pin_set）
-- 実行: `npm run db:test`。fixtureは架空データで、最後にrollbackする。

begin;

select plan(27);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000a2'),
  ('00000000-0000-4000-8000-0000000000a3');
insert into public.couple_spaces (id) values ('10000000-0000-4000-8000-0000000000f1');
insert into public.profiles (id, couple_space_id, display_name) values
  ('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000f1', 'fixture-a'),
  ('00000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000f1', 'fixture-b');

-- ---------------------------------------------------------------------------
-- 権限: テーブルは誰も直接触れない。関数はservice_roleだけが実行できる
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'private.pin_credentials', 'select'), 'anonはPINハッシュを読めない');
select ok(not has_table_privilege('authenticated', 'private.pin_credentials', 'select'), 'authenticatedはPINハッシュを読めない');
select ok(not has_table_privilege('service_role', 'private.pin_credentials', 'select'), 'service_roleもテーブルを直接読めない（関数経由のみ）');
select ok(not has_table_privilege('authenticated', 'private.login_throttles', 'update'), 'authenticatedは試行回数を変更できない');
select ok(not has_function_privilege('anon', 'public.pin_login_begin(uuid, text)', 'execute'), 'anonはpin_login_beginを実行できない');
select ok(not has_function_privilege('authenticated', 'public.pin_login_begin(uuid, text)', 'execute'), 'authenticatedはpin_login_beginを実行できない');
select ok(not has_function_privilege('authenticated', 'public.pin_set(uuid, text)', 'execute'), 'authenticatedはpin_setを実行できない');
select ok(not has_function_privilege('authenticated', 'public.pin_login_succeeded(uuid)', 'execute'), 'authenticatedはpin_login_succeededを実行できない');
select ok(has_function_privilege('service_role', 'public.pin_login_begin(uuid, text)', 'execute'), 'service_roleはpin_login_beginを実行できる');
select ok(has_function_privilege('service_role', 'public.pin_set(uuid, text)', 'execute'), 'service_roleはpin_setを実行できる');

-- ---------------------------------------------------------------------------
-- PINの設定
-- ---------------------------------------------------------------------------
set local role service_role;

select lives_ok(
  $$select public.pin_set('00000000-0000-4000-8000-0000000000a1', 'scrypt$1$32768$8$1$c2FsdA==$aGFzaA==')$$,
  'service_roleはPINハッシュを設定できる'
);
select throws_ok(
  $$select public.pin_set('00000000-0000-4000-8000-0000000000a3', 'scrypt$1$32768$8$1$c2FsdA==$aGFzaA==')$$,
  '23503',
  null,
  'profileの無いAuthユーザーにはPINを設定できない'
);
select throws_ok(
  $$select public.pin_set('00000000-0000-4000-8000-0000000000a2', 'plain-123456')$$,
  '23514',
  null,
  'scrypt形式以外（平文など）は保存できない'
);

-- ---------------------------------------------------------------------------
-- アカウント単位: 連続5回でロック
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(allowed order by g)
   from generate_series(1, 5) as g,
        lateral public.pin_login_begin('00000000-0000-4000-8000-0000000000a1', 'source-1')),
  array[true, true, true, true, true],
  '連続5回目までは試行できる'
);
select is(
  (select pin_hash from public.pin_login_begin('00000000-0000-4000-8000-0000000000a1', 'source-1')),
  null,
  '6回目はロック中のためPINハッシュを返さない'
);
select ok(
  (select retry_after_seconds between 800 and 900
   from public.pin_login_begin('00000000-0000-4000-8000-0000000000a1', 'source-1')),
  '1回目のロックは約15分'
);
select is(
  (select allowed from public.pin_login_begin('00000000-0000-4000-8000-0000000000a2', 'source-1')),
  true,
  'ロックはアカウント単位で、もう1人は同じ送信元からでも試行できる'
);

-- ロック期限切れを再現して2回目のロックが30分になることを確認
reset role;
update private.login_throttles set locked_until = now() - interval '1 second'
where scope = 'account' and subject = '00000000-0000-4000-8000-0000000000a1';
set local role service_role;

select is(
  (select count(*)::int from generate_series(1, 5) as g,
     lateral public.pin_login_begin('00000000-0000-4000-8000-0000000000a1', 'source-2') where allowed),
  5,
  'ロック期限後は再び5回まで試行できる'
);
select ok(
  (select retry_after_seconds between 1700 and 1800
   from public.pin_login_begin('00000000-0000-4000-8000-0000000000a1', 'source-2')),
  '2回目のロックは約30分（段階的に延びる）'
);

-- 成功で連続失敗とロックがリセットされる
select lives_ok(
  $$select public.pin_login_succeeded('00000000-0000-4000-8000-0000000000a1')$$,
  '成功を記録できる'
);
select is(
  (select allowed from public.pin_login_begin('00000000-0000-4000-8000-0000000000a1', 'source-3')),
  true,
  '成功の記録後はロックが解除される'
);
reset role;
select is(
  (select array[attempt_count, lockout_count] from private.login_throttles
   where scope = 'account' and subject = '00000000-0000-4000-8000-0000000000a1'),
  array[1, 0],
  '成功後は連続試行回数とロック段階が0から数え直される'
);

-- PIN再設定でロックが解除される
update private.login_throttles set locked_until = now() + interval '1 hour'
where scope = 'account' and subject = '00000000-0000-4000-8000-0000000000a1';
set local role service_role;
select public.pin_set('00000000-0000-4000-8000-0000000000a1', 'scrypt$1$32768$8$1$c2FsdA==$bmV3');
select is(
  (select allowed from public.pin_login_begin('00000000-0000-4000-8000-0000000000a1', 'source-3')),
  true,
  'PINを再設定するとアカウントのロックが解除される'
);

-- ---------------------------------------------------------------------------
-- 送信元単位: 1時間に20回でロック（成功を挟んでも数える）
-- ---------------------------------------------------------------------------
select public.pin_login_succeeded('00000000-0000-4000-8000-0000000000a2');
select is(
  (select count(*)::int
   from generate_series(1, 19) as g,
        lateral (select * from public.pin_login_begin('00000000-0000-4000-8000-0000000000a2', 'source-flood')) as b,
        lateral (select public.pin_login_succeeded('00000000-0000-4000-8000-0000000000a2')) as s
   where b.allowed),
  19,
  '同じ送信元から19回目までは（成功を挟めば）試行できる'
);
select is(
  (select allowed from public.pin_login_begin('00000000-0000-4000-8000-0000000000a2', 'source-flood')),
  true,
  '20回目の試行は受け付けられ、ここで送信元がロックされる'
);
select ok(
  (select not allowed and retry_after_seconds between 3500 and 3600
   from public.pin_login_begin('00000000-0000-4000-8000-0000000000a2', 'source-flood')),
  '21回目は送信元のロックにより約1時間拒否される'
);

-- 不正な引数
select throws_ok(
  $$select * from public.pin_login_begin('00000000-0000-4000-8000-0000000000a1', '')$$,
  '22023',
  null,
  '空の送信元は拒否する'
);

reset role;

select * from finish();
rollback;
