#!/usr/bin/env bash
set -Eeuo pipefail

# Validação local do adaptador S3 com um MinIO real. O cache do binário pode ser
# fixado pelo chamador via MINIO_BINARY/MINIO_URL; nenhum segredo é impresso.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
MINIO_BINARY="${MINIO_BINARY:-${TMPDIR:-/tmp}/gft-minio-bin/minio}"
MINIO_URL="${MINIO_URL:-https://sourceforge.net/projects/minio.mirror/files/RELEASE.2025-09-07T16-13-09Z/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z/download}"
MINIO_SHA256="${MINIO_SHA256:-}"
MINIO_PORT="${MINIO_PORT:-19000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-19001}"
MINIO_BUCKET="${MINIO_BUCKET:-gft-attachments-e2e}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-gft-e2e-user}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-gft-e2e-password-please-change}"
MINIO_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gft-minio-data.XXXXXX")"
MINIO_LOG="$(mktemp "${TMPDIR:-/tmp}/gft-minio-log.XXXXXX")"
MINIO_PID=""

cleanup() {
  if [[ -n "$MINIO_PID" ]] && kill -0 "$MINIO_PID" 2>/dev/null; then
    kill "$MINIO_PID" 2>/dev/null || true
    wait "$MINIO_PID" 2>/dev/null || true
  fi
  rm -rf "$MINIO_DATA_DIR" "$MINIO_LOG"
}
trap cleanup EXIT

mkdir -p "$(dirname -- "$MINIO_BINARY")"
if [[ ! -x "$MINIO_BINARY" ]]; then
  echo "Baixando o binário MinIO de um espelho SourceForge; valide MINIO_SHA256 antes de homologar..."
  curl --fail --location --silent --show-error "$MINIO_URL" -o "$MINIO_BINARY"
  chmod 0755 "$MINIO_BINARY"
  if [[ -n "$MINIO_SHA256" ]]; then
    printf '%s  %s\n' "$MINIO_SHA256" "$MINIO_BINARY" | sha256sum --check --status
  fi
fi
"$MINIO_BINARY" --version | sed -n '1p'

(
  export MINIO_ROOT_USER MINIO_ROOT_PASSWORD
  exec "$MINIO_BINARY" server "$MINIO_DATA_DIR" --address ":$MINIO_PORT" --console-address ":$MINIO_CONSOLE_PORT"
) >"$MINIO_LOG" 2>&1 &
MINIO_PID=$!

for attempt in $(seq 1 60); do
  if curl --fail --silent "http://127.0.0.1:$MINIO_PORT/minio/health/live" >/dev/null; then
    break
  fi
  if ! kill -0 "$MINIO_PID" 2>/dev/null; then
    cat "$MINIO_LOG" >&2
    exit 1
  fi
  sleep 0.25
done
curl --fail --silent "http://127.0.0.1:$MINIO_PORT/minio/health/live" >/dev/null

echo "MinIO disponível em porta $MINIO_PORT; executando verificações do adaptador..."
(
  cd "$BACKEND_DIR"
  npm run build --silent
  S3_ENDPOINT="http://127.0.0.1:$MINIO_PORT" \
  S3_REGION="us-east-1" \
  S3_BUCKET="$MINIO_BUCKET" \
  S3_ACCESS_KEY_ID="$MINIO_ROOT_USER" \
  S3_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
  S3_FORCE_PATH_STYLE="true" \
  node "$SCRIPT_DIR/verify-minio.mjs"
)

echo "Validação MinIO concluída; dados temporários removidos no encerramento."
