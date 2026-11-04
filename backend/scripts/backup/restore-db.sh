#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROUTINE="$SCRIPT_DIR/backup-restore-isolated.sh"

usage() {
  cat <<'USAGE'
Uso:
  restore-db.sh BACKUP_FILE --confirm-restore [--target-schema gft_restore_test]

A restauração é sempre feita em gft_restore_test (ou em um nome com esse
prefixo) e removida ao final. O schema gft_inteligente é recusado.
USAGE
}

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  usage
  exit 0
fi
[[ $# -ge 2 ]] || { usage >&2; exit 64; }

backup_file="$1"
shift
confirmed_restore=false
target_schema='gft_restore_test'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm-restore) confirmed_restore=true; shift ;;
    --target-schema)
      [[ $# -ge 2 ]] || { printf 'ERRO: --target-schema requer um valor.\n' >&2; exit 64; }
      target_schema="$2"
      shift 2
      ;;
    *) printf 'ERRO: argumento desconhecido.\n' >&2; usage >&2; exit 64 ;;
  esac
done
if [[ "$confirmed_restore" != true ]]; then
  printf 'ERRO: restauração recusada; informe --confirm-restore explicitamente.\n' >&2
  exit 64
fi

exec "$ROUTINE" --restore-only "$backup_file" "$target_schema"
