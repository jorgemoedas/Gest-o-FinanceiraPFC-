#!/usr/bin/env bash
set -Eeuo pipefail

# Roteiro de backup/restauração para o schema da aplicação.
# A restauração nunca aceita o schema da aplicação e só aceita destinos com
# prefixo gft_restore_test. Não use este arquivo para sobrescrever produção.

readonly APP_SCHEMA='gft_inteligente'
readonly DEFAULT_TARGET_SCHEMA='gft_restore_test'
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_ENV_FILE="$(cd -- "$SCRIPT_DIR/../.." && pwd)/.env"
readonly DEFAULT_BACKUP_DIR="${BACKUP_DIR:-${TMPDIR:-${PWD}/.tmp}/gftauth-backups}"
readonly TABLE_LABELS=(
  'usuarios'
  'empresas'
  'vinculos'
  'lancamentos_financeiros'
  'contrapartes'
  'perfil_empresarial'
  'auditoria'
  'obrigacoes_fiscais'
)
readonly TABLE_NAMES=(
  'User'
  'Company'
  'CompanyMembership'
  'FinanceTransaction'
  'FinanceCounterparty'
  'CompanyProfile'
  'AuditLog'
  'FiscalObligation'
)

usage() {
  cat <<'USAGE'
Uso:
  backup-restore-isolated.sh --run [BACKUP_DIR]
  backup-restore-isolated.sh --dump-only [BACKUP_DIR]
  backup-restore-isolated.sh --restore-only BACKUP_FILE [TARGET_SCHEMA]

O DATABASE_URL é carregado de backend/.env por padrão, sem ser impresso.
BACKUP_DIR também pode ser informado por BACKUP_DIR; o padrão é `${TMPDIR:-.tmp}/gftauth-backups`.
A restauração traduz o dump para um schema isolado. O destino precisa ser
"gft_restore_test" ou começar por "gft_restore_test_"; gft_inteligente é recusado.
USAGE
}

fail() {
  printf 'ERRO: %s\n' "$1" >&2
  exit "${2:-1}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "ferramenta necessária indisponível: $1" 69
}

check_tools() {
  local command_name
  for command_name in pg_dump pg_restore psql perl date stat sha256sum mktemp; do
    require_command "$command_name"
  done
}

load_environment() {
  local env_file="${ENV_FILE:-$DEFAULT_ENV_FILE}"
  if [[ -f "$env_file" ]]; then
    set -a
    # O arquivo é o backend/.env do projeto e pode conter valores citados.
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
  [[ -n "${DATABASE_URL:-}" ]] || fail 'DATABASE_URL não está definida no ambiente.' 64
}

validate_target_schema() {
  local target_schema="$1"
  [[ "$target_schema" != "$APP_SCHEMA" ]] || fail 'restauração recusada: o schema da aplicação é somente fonte.' 65
  [[ "$target_schema" =~ ^gft_restore_test(_[A-Za-z0-9_]+)?$ ]] || \
    fail 'destino recusado: use gft_restore_test ou um nome com prefixo gft_restore_test_.' 65
}

psql_query() {
  local sql="$1"
  local error_log="$2"
  psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname="$DATABASE_URL" \
    --command="$sql" 2>"$error_log"
}

collect_counts() {
  local schema="$1"
  local output_file="$2"
  local error_log
  error_log="$(mktemp)"
  if [[ "$schema" != "$APP_SCHEMA" && ! "$schema" =~ ^gft_restore_test(_[A-Za-z0-9_]+)?$ ]]; then
    rm -f -- "$error_log"
    fail 'schema inválido para contagem.' 65
  fi
  if ! psql --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
      --set="target_schema=$schema" --dbname="$DATABASE_URL" 2>"$error_log" >"$output_file" <<'SQL'
SELECT 'usuarios', count(*)::bigint FROM :"target_schema"."User"
UNION ALL SELECT 'empresas', count(*)::bigint FROM :"target_schema"."Company"
UNION ALL SELECT 'vinculos', count(*)::bigint FROM :"target_schema"."CompanyMembership"
UNION ALL SELECT 'lancamentos_financeiros', count(*)::bigint FROM :"target_schema"."FinanceTransaction"
UNION ALL SELECT 'contrapartes', count(*)::bigint FROM :"target_schema"."FinanceCounterparty"
UNION ALL SELECT 'perfil_empresarial', count(*)::bigint FROM :"target_schema"."CompanyProfile"
UNION ALL SELECT 'auditoria', count(*)::bigint FROM :"target_schema"."AuditLog"
UNION ALL SELECT 'obrigacoes_fiscais', count(*)::bigint FROM :"target_schema"."FiscalObligation"
ORDER BY 1;
SQL
  then
    rm -f -- "$error_log"
    fail 'não foi possível obter as contagens; o detalhe foi mantido fora da saída.'
  fi
  rm -f -- "$error_log"
  [[ -s "$output_file" ]] || fail 'a consulta de contagens não retornou dados.'
}

assert_counts_match() {
  local before_file="$1"
  local after_file="$2"
  local diff_file
  diff_file="$(mktemp)"
  if ! diff -u -- "$before_file" "$after_file" >"$diff_file"; then
    rm -f -- "$diff_file"
    fail 'as contagens do destino não conferem com a origem.' 1
  fi
  rm -f -- "$diff_file"
}

run_dump() {
  local backup_dir="${1:-$DEFAULT_BACKUP_DIR}"
  local timestamp backup_file count_file error_log started_ms finished_ms
  umask 077
  mkdir -p -- "$backup_dir"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_file="$backup_dir/gftauth-${timestamp}.dump"
  [[ ! -e "$backup_file" ]] || backup_file="$backup_dir/gftauth-${timestamp}-${BASHPID}.dump"
  count_file="$backup_dir/gftauth-${timestamp}.before.tsv"
  error_log="$(mktemp)"

  collect_counts "$APP_SCHEMA" "$count_file"
  started_ms="$(date +%s%3N)"
  if ! pg_dump --dbname="$DATABASE_URL" --schema="$APP_SCHEMA" --format=custom \
      --compress=9 --file="$backup_file" > /dev/null 2>"$error_log"; then
    rm -f -- "$error_log" "$backup_file"
    fail 'pg_dump falhou; o detalhe foi mantido fora da saída para não expor a conexão.'
  fi
  finished_ms="$(date +%s%3N)"
  rm -f -- "$error_log"
  pg_restore --list "$backup_file" > /dev/null 2>"$backup_dir/.pg_restore-list.err" || {
    rm -f -- "$backup_file" "$backup_dir/.pg_restore-list.err"
    fail 'o arquivo custom produzido não passou na verificação pg_restore.'
  }
  rm -f -- "$backup_dir/.pg_restore-list.err"

  DUMP_ARCHIVE="$backup_file"
  DUMP_COUNT_FILE="$count_file"
  DUMP_SIZE_BYTES="$(stat -c '%s' -- "$backup_file")"
  DUMP_SHA256="$(sha256sum -- "$backup_file" | awk '{print $1}')"
  DUMP_DURATION_MS=$((finished_ms - started_ms))
  printf 'dump_file=%s\ndump_size_bytes=%s\ndump_sha256=%s\ndump_duration_ms=%s\ncounts_before=%s\n' \
    "$DUMP_ARCHIVE" "$DUMP_SIZE_BYTES" "$DUMP_SHA256" "$DUMP_DURATION_MS" "$DUMP_COUNT_FILE"
}

run_restore() {
  local backup_file="$1"
  local target_schema="${2:-$DEFAULT_TARGET_SCHEMA}"
  local before_file="${3:-}"
  local restore_dir sql_file translated_sql error_log started_ms finished_ms after_file
  validate_target_schema "$target_schema"
  [[ -f "$backup_file" ]] || fail 'arquivo de backup não encontrado.' 66
  pg_restore --list "$backup_file" > /dev/null 2>"$(mktemp)" || fail 'arquivo custom inválido.' 1
  if ! pg_restore --list "$backup_file" | grep -Fq "SCHEMA - $APP_SCHEMA"; then
    fail 'o dump não contém o schema de aplicação esperado.' 65
  fi

  restore_dir="$(dirname -- "$backup_file")"
  before_file="${before_file:-$restore_dir/restore-$(date -u +%Y%m%dT%H%M%SZ).before.tsv}"
  [[ -f "$before_file" ]] || collect_counts "$APP_SCHEMA" "$before_file"
  after_file="${before_file%.before.tsv}.after.tsv"
  sql_file="$(mktemp)"
  translated_sql="$(mktemp)"
  error_log="$(mktemp)"
  TARGET_SCHEMA_ACTIVE="$target_schema"
  CLEANUP_NEEDED=true
  cleanup_isolated_on_exit() {
    local exit_status=$?
    if [[ "${CLEANUP_NEEDED:-false}" == true ]]; then
      psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 --dbname="$DATABASE_URL" \
        --command="DROP SCHEMA IF EXISTS \"$TARGET_SCHEMA_ACTIVE\" CASCADE;" \
        >/dev/null 2>/dev/null || true
    fi
    exit "$exit_status"
  }
  trap cleanup_isolated_on_exit EXIT
  started_ms="$(date +%s%3N)"

  # Só este nome, previamente validado, pode ser descartado. O schema da
  # aplicação não aparece em nenhum DROP deste roteiro.
  if ! psql_query "DROP SCHEMA IF EXISTS \"$target_schema\" CASCADE;" "$error_log" >/dev/null; then
    rm -f -- "$sql_file" "$translated_sql" "$error_log"
    fail 'não foi possível preparar o schema isolado.'
  fi

  if ! pg_restore --no-owner --no-privileges --no-tablespaces --exit-on-error \
      --file="$sql_file" "$backup_file" 2>"$error_log"; then
    rm -f -- "$sql_file" "$translated_sql" "$error_log"
    fail 'não foi possível materializar o dump para restauração.'
  fi
  # O dump é de um único schema. A substituição fica restrita ao identificador
  # do schema (e não a substrings de nomes de tabelas ou a credenciais).
  perl -pe "s/(?<![A-Za-z0-9_])$APP_SCHEMA(?![A-Za-z0-9_])/$target_schema/g" \
    "$sql_file" >"$translated_sql"

  if ! psql --no-psqlrc --quiet --single-transaction --set=ON_ERROR_STOP=1 \
      --dbname="$DATABASE_URL" <"$translated_sql" > /dev/null 2>"$error_log"; then
    rm -f -- "$sql_file" "$translated_sql" "$error_log"
    fail 'pg_restore para o schema isolado falhou; o detalhe foi mantido fora da saída.'
  fi
  finished_ms="$(date +%s%3N)"
  collect_counts "$target_schema" "$after_file"
  assert_counts_match "$before_file" "$after_file"
  rm -f -- "$sql_file" "$translated_sql" "$error_log"

  if ! psql_query "DROP SCHEMA IF EXISTS \"$target_schema\" CASCADE;" "$(mktemp)" >/dev/null; then
    fail 'a limpeza do schema isolado falhou.'
  fi
  if [[ "$(psql --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 \
      --dbname="$DATABASE_URL" --command="SELECT NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '$target_schema');" \
      2>"$(mktemp)" | tr -d '[:space:]')" != 't' ]]; then
    fail 'não foi possível comprovar a remoção do schema isolado.'
  fi
  CLEANUP_NEEDED=false
  trap - EXIT

  RESTORE_AFTER_FILE="$after_file"
  RESTORE_DURATION_MS=$((finished_ms - started_ms))
  RESTORE_TARGET_SCHEMA="$target_schema"
  RESTORE_COUNTS_MATCH=true
  RESTORE_CLEANUP_VERIFIED=true
  printf 'restore_target_schema=%s\nrestore_duration_ms=%s\ncounts_after=%s\ncounts_match=true\ncleanup_verified=true\n' \
    "$RESTORE_TARGET_SCHEMA" "$RESTORE_DURATION_MS" "$RESTORE_AFTER_FILE"
}

main() {
  local mode="${1:-}"
  check_tools
  load_environment
  case "$mode" in
    --help|-h)
      usage
      ;;
    --dump-only)
      run_dump "${2:-$DEFAULT_BACKUP_DIR}"
      ;;
    --run)
      run_dump "${2:-$DEFAULT_BACKUP_DIR}"
      run_restore "$DUMP_ARCHIVE" "$DEFAULT_TARGET_SCHEMA" "$DUMP_COUNT_FILE"
      ;;
    --restore-only)
      [[ $# -ge 2 && $# -le 3 ]] || { usage >&2; exit 64; }
      run_restore "$2" "${3:-$DEFAULT_TARGET_SCHEMA}"
      ;;
    *)
      usage >&2
      exit 64
      ;;
  esac
}

main "$@"
