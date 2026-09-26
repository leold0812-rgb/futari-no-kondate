#!/usr/bin/env bash
# 2人上限が「同時に3人目を追加する2接続」でも守られることを、実際の2つのDB接続で検証する。
# pgTAPは1 transaction内で動くため、接続をまたぐ競合はこのスクリプトで確認する。
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
USER_2='00000000-0000-4000-8000-0000000000c2' # 同時に追加する候補
USER_3='00000000-0000-4000-8000-0000000000c3' # 同時に追加する候補

sql() { psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

tmp_dir="$(mktemp -d)"

cleanup_fixtures() {
  sql -c "delete from auth.users where id in ('$USER_1','$USER_2','$USER_3');" \
      -c "delete from public.couple_spaces where id = '$SPACE';" >/dev/null 2>&1 || true
}
trap 'cleanup_fixtures; rm -rf "$tmp_dir"' EXIT
cleanup_fixtures

sql -c "insert into auth.users (id) values ('$USER_1'), ('$USER_2'), ('$USER_3');" \
    -c "insert into public.couple_spaces (id) values ('$SPACE');" \
    -c "insert into public.profiles (id, couple_space_id, display_name) values ('$USER_1', '$SPACE', 'fixture-1');"

# 接続1: メンバー追加後、commitせず3秒保持（space行のロックを持ち続ける）
sql -c "begin; insert into public.profiles (id, couple_space_id, display_name) values ('$USER_2', '$SPACE', 'fixture-2'); select pg_sleep(3); commit;" \
  >/dev/null 2>"$tmp_dir/conn1.err" &
conn1=$!

sleep 1

# 接続2: 接続1のcommit待ちの後、件数が2に達しているため拒否されるはず
set +e
sql -c "insert into public.profiles (id, couple_space_id, display_name) values ('$USER_3', '$SPACE', 'fixture-3');" \
  >/dev/null 2>"$tmp_dir/conn2.err"
conn2_status=$?
set -e

wait "$conn1"
conn1_status=$?

count="$(sql -At -c "select count(*) from public.profiles where couple_space_id = '$SPACE';")"

fail=0
[ "$conn1_status" -eq 0 ] || { echo "NG: 接続1（先行）が失敗しました"; fail=1; }
[ "$conn2_status" -ne 0 ] || { echo "NG: 接続2（3人目）が拒否されませんでした"; fail=1; }
grep -q "maximum of 2 profiles" "$tmp_dir/conn2.err" || { echo "NG: 接続2の失敗理由が上限違反ではありません"; fail=1; }
[ "$count" = "2" ] || { echo "NG: spaceのprofile数が2ではありません（${count}）"; fail=1; }

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "OK: 同時追加でもspaceのprofileは2件を超えず、3人目は上限違反で拒否されました。"
