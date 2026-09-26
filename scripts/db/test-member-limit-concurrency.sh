#!/usr/bin/env bash
# 2人上限が「同時に3人目を追加する2接続」でも、transaction分離レベルに依らず守られることを、
# 実際の2つのDB接続で検証する。pgTAPは1 transaction内で動くため、接続をまたぐ競合はこのスクリプトで確認する。
#
# シナリオ:
#   1. read committed（既定）: 先行接続のcommitを待ってから件数を数え直す
#   2. repeatable read: 後続接続が先行接続のcommit「前」にsnapshotを取り、commit「後」に追加を試みる
#      （古いsnapshotで件数を数えると3人目が通ってしまう。serialization failureまたは上限違反で拒否されること）
#   3. serializable: 2と同様
#
# 使い方: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:test:concurrency
# ローカルDB専用。ホストが127.0.0.1 / localhost 以外なら実行を拒否する（Production / Developmentのhosted DBを触らない）。
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

host="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#')"
case "$host" in
  127.0.0.1|localhost) ;;
  *) echo "拒否: ローカルDB（127.0.0.1 / localhost）以外には接続しません。" >&2; exit 2 ;;
esac

# 架空fixture（実在のユーザー情報は使わない）
SPACE='10000000-0000-4000-8000-0000000000c1'
USER_1='00000000-0000-4000-8000-0000000000c1' # 既存メンバー
USER_2='00000000-0000-4000-8000-0000000000c2' # 先行接続が追加する候補
USER_3='00000000-0000-4000-8000-0000000000c3' # 後続接続が追加する候補（拒否されるべき3人目）

sql() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

tmp_dir="$(mktemp -d)"

cleanup_fixtures() {
  sql -c "delete from auth.users where id in ('$USER_1','$USER_2','$USER_3');" \
      -c "delete from public.couple_spaces where id = '$SPACE';" >/dev/null 2>&1 || true
}
trap 'cleanup_fixtures; rm -rf "$tmp_dir"' EXIT

INSERT_USER_3="insert into public.profiles (id, couple_space_id, display_name) values ('$USER_3', '$SPACE', 'fixture-3');"

# run_scenario <名前> <後続接続のSQL> <許容するエラーメッセージのegrep>
run_scenario() {
  local name="$1" conn2_sql="$2" expected_error="$3"
  local fail=0

  cleanup_fixtures
  sql -c "insert into auth.users (id) values ('$USER_1'), ('$USER_2'), ('$USER_3');" \
      -c "insert into public.couple_spaces (id) values ('$SPACE');" \
      -c "insert into public.profiles (id, couple_space_id, display_name) values ('$USER_1', '$SPACE', 'fixture-1');"

  # 先行接続: 1秒後にメンバーを追加し、commitせず約3秒保持（t≒1〜4秒）
  ( sleep 1; sql -c "begin; insert into public.profiles (id, couple_space_id, display_name) values ('$USER_2', '$SPACE', 'fixture-2'); select pg_sleep(3); commit;" ) \
    >/dev/null 2>"$tmp_dir/conn1.err" &
  local conn1=$!

  # 後続接続（シナリオごとのSQL）
  set +e
  sql -c "$conn2_sql" >/dev/null 2>"$tmp_dir/conn2.err"
  local conn2_status=$?
  set -e

  wait "$conn1"
  local conn1_status=$?

  local count
  count="$(sql -At -c "select count(*) from public.profiles where couple_space_id = '$SPACE';")"

  [ "$conn1_status" -eq 0 ] || { echo "NG[$name]: 先行接続が失敗しました"; fail=1; }
  [ "$conn2_status" -ne 0 ] || { echo "NG[$name]: 後続接続（3人目）が拒否されませんでした"; fail=1; }
  grep -qE "$expected_error" "$tmp_dir/conn2.err" || {
    echo "NG[$name]: 後続接続の失敗理由が想定外です: $(head -c 200 "$tmp_dir/conn2.err")"; fail=1; }
  [ "$count" = "2" ] || { echo "NG[$name]: spaceのprofile数が2ではありません（${count}）"; fail=1; }

  [ "$fail" -eq 0 ] || return 1
  echo "OK[$name]: 3人目は拒否され、profileは2件のままです（${expected_error}）"
}

# 1. read committed: 先行接続がロック/更新中の間にt≒1.5秒で追加を試みる → commit待ちの後、件数2で上限違反
run_scenario "read committed" "select pg_sleep(1.5); $INSERT_USER_3" "maximum of 2 profiles"

# 2. repeatable read: t≒0でsnapshotを取り、先行接続のcommit（t≒4秒）後のt≒5秒に追加を試みる
run_scenario "repeatable read" \
  "begin isolation level repeatable read; select count(*) from public.profiles; select pg_sleep(5); $INSERT_USER_3 commit;" \
  "could not serialize access|maximum of 2 profiles"

# 3. serializable: repeatable readと同様
run_scenario "serializable" \
  "begin isolation level serializable; select count(*) from public.profiles; select pg_sleep(5); $INSERT_USER_3 commit;" \
  "could not serialize access|maximum of 2 profiles"

echo "OK: 同時追加でも、分離レベルに依らずspaceのprofileは2件を超えません。"
