-- Gate 1.1 修正: 2人上限を transaction分離レベルに依らず守る
--
-- 問題（PR #3のレビューで発見・再現済み）:
--   20260926180000 の上限triggerは、対象space行を `FOR UPDATE` でロックしてからprofile数を数えていた。
--   read committed ではロック取得後に件数を数え直すため正しく動くが、repeatable read 以上では、
--   ロックしただけの（更新されていない）行では競合が検出されず、transaction開始時の古いsnapshotで件数を数えるため、
--   先行transactionが同じspaceへcommitしたprofileが見えず、3人目が登録できてしまう。
--
-- 修正:
--   `FOR UPDATE` の代わりに、対象space行を `UPDATE`（updated_atの更新）する。
--   * read committed: 先行transactionのcommitまで待機し、行の最新版に対して更新→その後の件数取得は新しいsnapshotなので正しい。
--   * repeatable read / serializable: 先行transactionが同じspace行を更新してcommit済みなら
--     `could not serialize access due to concurrent update`（40001）で失敗する。
--     先行transactionはprofileを追加するたびにspace行を更新するため、「snapshot取得後に同じspaceへprofileが増えた」
--     場合は必ずこの競合として検出される。競合が無ければsnapshotの件数は正確。
--   ロック対象は引き続き1行のみでdeadlockしない。
--
-- 既存migrationは書き換えず、関数を差し替える（trigger・grants・所有者は変更しない）。
-- 副作用: profile追加・移動のたびに、対象spaceのupdated_atが更新される。

create or replace function private.enforce_couple_space_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_count integer;
begin
  update public.couple_spaces as s
  set updated_at = pg_catalog.now()
  where s.id = new.couple_space_id;

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
