#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROUTINE="$SCRIPT_DIR/backup-restore-isolated.sh"
DEFAULT_BACKUP_DIR="${BACKUP_DIR:-${TMPDIR:-${PWD}/.tmp}/gftauth-backups}"

if [[ "${1:-}" == '--check' ]]; then
  for command_name in pg_dump pg_restore psql perl date stat sha256sum mktemp; do
    command -v "$command_name" >/dev/null 2>&1 || {
      printf 'ERRO: ferramenta necessária indisponível: %s\n' "$command_name" >&2
      exit 69
    }
  done
  printf 'Verificação de ferramentas concluída; nenhum backup foi executado.\n'
  exit 0
fi

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  exec "$ROUTINE" --help
fi

exec "$ROUTINE" --dump-only "${1:-$DEFAULT_BACKUP_DIR}"
