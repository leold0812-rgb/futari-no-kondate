#!/bin/bash
# hosted Developmentの初期設定をまとめて行う（docs/runbooks/hosted-development-setup.md の C〜G）。
#
#   bash scripts/setup/dev-setup.sh
#
# 聞かれたものに答えるだけで進む。キーやPINは画面に表示せず、ログにも残さない。
#   C. .env.bootstrap.local を作る（PIN_PEPPERは自動で作る。すでに入っている値はそのまま使う）
#   D. 2人のアカウント登録（確認 → 実行 → もう一度実行して「変更なし」を確認）
#   E. session発行の確認
#   F. 2人のPINを設定（それぞれ本人が入力）
#   G. Vercel（Preview）へ SUPABASE_SERVICE_ROLE_KEY と PIN_PEPPER を登録
# 何度実行しても同じ結果になる（登録済みのものは変えない。PINは設定し直すか聞く）。
set -euo pipefail

cd "$(dirname "$0")/../.."
ENV_FILE=".env.bootstrap.local"
REF="jqkslfjdppwliugchwbm"
umask 077

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() { printf '\nエラー: %s\n' "$1" >&2; exit 1; }
confirm() {
  local answer
  printf '%s [y/N]: ' "$1"
  read -r answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ]
}
# 既存ファイルの値（無ければ空）。値は表示しない
current() {
  [ -f "${ENV_FILE}" ] || return 0
  grep -E "^$1=" "${ENV_FILE}" | tail -n 1 | cut -d= -f2- | tr -d '\r' || true
}

say "C. 設定ファイル（${ENV_FILE}）"
PUBLISHABLE="$(current NEXT_PUBLIC_SUPABASE_ANON_KEY)"
SECRET="$(current SUPABASE_SERVICE_ROLE_KEY)"
NAME1="$(current BOOTSTRAP_MEMBER_1_DISPLAY_NAME)"
NAME2="$(current BOOTSTRAP_MEMBER_2_DISPLAY_NAME)"
PEPPER="$(current PIN_PEPPER)"

if [ -z "${PUBLISHABLE}" ]; then
  echo "Supabase Dashboard → Project Settings → API Keys の「Publishable key」（sb_publishable_...）を貼って Enter（画面には出ません）"
  read -rs PUBLISHABLE; echo
fi
case "${PUBLISHABLE}" in sb_publishable_*|eyJ*) ;; *) fail "Publishable key の形ではありません（sb_publishable_ で始まる値）。もう一度実行してください。" ;; esac

if [ -z "${SECRET}" ]; then
  echo "同じ画面の Secret keys にある localadmin の値（sb_secret_...）を貼って Enter（画面には出ません）"
  read -rs SECRET; echo
fi
case "${SECRET}" in sb_secret_*|eyJ*) ;; *) fail "Secret key の形ではありません（sb_secret_ で始まる値）。もう一度実行してください。" ;; esac

if [ -z "${NAME1}" ]; then
  printf '1人目の表示名（ログイン画面に出る名前）: '
  read -r NAME1
fi
if [ -z "${NAME2}" ]; then
  printf '2人目の表示名: '
  read -r NAME2
fi
[ -n "${NAME1}" ] && [ -n "${NAME2}" ] || fail "表示名が空です。もう一度実行してください。"
[ "${NAME1}" != "${NAME2}" ] || fail "2人の表示名は別の名前にしてください。"

if [ -z "${PEPPER}" ]; then
  PEPPER="$(openssl rand -base64 48 | tr -d '\n')"
  echo "PIN_PEPPER を新しく作りました（表示しません）。"
fi

{
  printf '%s\n' "NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co"
  printf '%s\n' "NEXT_PUBLIC_SUPABASE_ANON_KEY=${PUBLISHABLE}"
  printf '%s\n' "SUPABASE_SERVICE_ROLE_KEY=${SECRET}"
  printf '%s\n' "BOOTSTRAP_MEMBER_1_EMAIL=member-1@futari-no-kondate.invalid"
  printf '%s\n' "BOOTSTRAP_MEMBER_1_DISPLAY_NAME=${NAME1}"
  printf '%s\n' "BOOTSTRAP_MEMBER_2_EMAIL=member-2@futari-no-kondate.invalid"
  printf '%s\n' "BOOTSTRAP_MEMBER_2_DISPLAY_NAME=${NAME2}"
  printf '%s\n' "PIN_PEPPER=${PEPPER}"
} > "${ENV_FILE}"
chmod 600 "${ENV_FILE}"
echo "保存しました（${ENV_FILE}、Git管理外）。"

say "D. 2人のアカウント登録（まず確認だけ）"
node --env-file="${ENV_FILE}" scripts/auth/bootstrap-couple.mts --project-ref "${REF}"
if confirm "上の内容で登録しますか"; then
  node --env-file="${ENV_FILE}" scripts/auth/bootstrap-couple.mts --project-ref "${REF}" --apply
  echo "もう一度実行して「変更なし」になるか確認します。"
  node --env-file="${ENV_FILE}" scripts/auth/bootstrap-couple.mts --project-ref "${REF}" --apply
else
  fail "登録を中止しました。"
fi

say "E. ログイン（session発行）の確認"
node --env-file="${ENV_FILE}" scripts/auth/smoke-session.mts --project-ref "${REF}"

say "F. 2人のPIN（6〜12桁の数字。同じ数字だけは不可）"
if confirm "1人目（${NAME1}）のPINを設定しますか（本人が入力）"; then
  node --env-file="${ENV_FILE}" scripts/auth/set-pin.mts --project-ref "${REF}" --member 1
fi
if confirm "2人目（${NAME2}）のPINを設定しますか（本人に交代して入力）"; then
  node --env-file="${ENV_FILE}" scripts/auth/set-pin.mts --project-ref "${REF}" --member 2
fi

say "G. Vercel（Preview環境）への登録"
if ! command -v vercel >/dev/null 2>&1; then
  echo "Vercel CLIが無いため飛ばしました。Claudeに伝えてください。"
  exit 0
fi
echo "Preview用のsecret keyを貼って Enter（画面には出ません）。"
echo "Enterだけ押すと、さっきの localadmin と同じキーを使います。"
read -rs VERCEL_SECRET; echo
[ -n "${VERCEL_SECRET}" ] || VERCEL_SECRET="${SECRET}"
case "${VERCEL_SECRET}" in sb_secret_*|eyJ*) ;; *) fail "Secret key の形ではありません。" ;; esac
printf '%s' "${VERCEL_SECRET}" | vercel env add SUPABASE_SERVICE_ROLE_KEY preview --sensitive --force --yes >/dev/null
echo "SUPABASE_SERVICE_ROLE_KEY を登録しました。"
printf '%s' "${PEPPER}" | vercel env add PIN_PEPPER preview --sensitive --force --yes >/dev/null
echo "PIN_PEPPER を登録しました。"

say "完了しました。Claudeに「終わった」と伝えてください（Previewを作り直してログインを確認します）。"
