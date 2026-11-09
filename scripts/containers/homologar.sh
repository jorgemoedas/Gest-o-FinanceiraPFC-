#!/usr/bin/env bash
set -Eeuo pipefail

# Homologação de produção do GFT Inteligente.
# O modo padrão sempre executa as verificações estáticas. Se houver Docker ou
# Podman com Compose, também constrói e exercita os dois serviços.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-gftauth-frontend:homologacao}"
BACKEND_IMAGE="${BACKEND_IMAGE:-gftauth-backend:homologacao}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
export FRONTEND_IMAGE BACKEND_IMAGE FRONTEND_PORT BACKEND_PORT
KEEP_RUNNING=0
CLEAN_VOLUMES=0
STATIC_ONLY=0
RUNTIME=""
COMPOSE=()

usage() {
  cat <<'EOF'
Uso: scripts/containers/homologar.sh [opções]

Opções:
  --static-only  Executa apenas a auditoria estática, sem build ou subida.
  --keep         Mantém os serviços ativos ao terminar (não recomendado para CI).
  --clean        Remove também volumes do Compose; pode apagar anexos persistidos.
  -h, --help     Exibe esta ajuda.

Variáveis opcionais: FRONTEND_IMAGE, BACKEND_IMAGE, FRONTEND_PORT e BACKEND_PORT.
As credenciais devem ser fornecidas somente por um ambiente de homologação já
preparado para o Compose; o roteiro não lê nem imprime arquivos .env.
EOF
}

log() { printf '[containers] %s\n' "$*"; }
fail() { printf '[containers][FALHA] %s\n' "$*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --static-only) STATIC_ONLY=1 ;;
    --keep) KEEP_RUNNING=1 ;;
    --clean) CLEAN_VOLUMES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "Opção desconhecida: $arg" ;;
  esac
done

require_file() {
  [[ -f "$1" ]] || fail "Arquivo ausente: $1"
}

require_text() {
  local file="$1" pattern="$2" description="$3"
  grep -Eq "$pattern" "$file" || fail "Verificação ausente (${description}) em ${file}"
}

check_dockerfile() {
  local file="$1" port="$2" role="$3"
  require_file "$file"
  local stages
  stages="$(grep -Ec '^FROM[[:space:]]+' "$file")"
  (( stages >= 3 )) || fail "${role}: Dockerfile não é multiestágio (estágios: ${stages})"
  require_text "$file" 'USER[[:space:]]+node' "usuário não-root node"
  require_text "$file" "PORT=${port}" "PORT padrão ${port}"
  require_text "$file" 'HEALTHCHECK' "healthcheck"
  require_text "$file" 'EXPOSE[[:space:]]+[0-9]+' "porta exposta"
}

check_ignore() {
  local file="$1"
  require_file "$file"
  require_text "$file" '(^|/)\*\*/?node_modules|(^|/)node_modules' 'exclusão de node_modules'
  require_text "$file" '(^|/)\*\*/?\.env|(^|/)\.env' 'exclusão de .env'
  require_text "$file" '(^|/)\*\*/?\.git|(^|/)\.git' 'exclusão de .git'
  require_text "$file" 'dist|build|out|\.next|coverage' 'exclusão de artefatos de build'
}

static_checks() {
  cd "$ROOT_DIR"
  log 'Executando auditoria estática dos artefatos de produção.'
  check_dockerfile Dockerfile 3000 frontend
  check_dockerfile backend/Dockerfile 3001 backend
  require_text Dockerfile 'COPY[[:space:]]+--from=builder.*\.next/standalone' 'root standalone do Next'
  require_text Dockerfile 'COPY[[:space:]]+--from=builder.*\.next/static' 'estáticos do Next'
  require_text Dockerfile 'COPY[[:space:]]+--from=builder.*public' 'diretório public do Next'
  require_text Dockerfile 'CMD[[:space:]]+\["node",[[:space:]]*"server\.js"\]' 'comando standalone do Next'
  require_text backend/Dockerfile 'npm ci[[:space:]]+--omit=dev' 'dependências somente de produção'
  require_text backend/Dockerfile 'npm run prisma:generate' 'geração do cliente Prisma no estágio de build'
  require_text backend/Dockerfile 'COPY[[:space:]]+--from=builder.* /app/dist' 'saída compilada do backend'
  require_text backend/Dockerfile 'CMD[[:space:]]+\["node",[[:space:]]*"dist/main\.js"\]' 'comando compilado do backend'
  check_ignore .dockerignore
  check_ignore backend/.dockerignore
  require_file docker-compose.yml
  require_text docker-compose.yml 'condition:[[:space:]]+service_healthy' 'dependência pela saúde'
  require_text docker-compose.yml 'healthcheck:' 'healthcheck do Compose'
  require_text docker-compose.yml '/health' 'probe público do backend'
  require_text docker-compose.yml "'/'" 'probe público do frontend'
  require_text docker-compose.yml 'PORT:' 'PORT configurável'
  require_text backend/src/modules/health/health.controller.ts '@Get\(\)' 'GET /health público'
  require_text backend/src/modules/health/health.controller.ts "@Get\('ready'\)" 'GET /health/ready público'
  require_text next.config.ts "output:[[:space:]]*'standalone'" 'saída standalone do Next'

  # Valores de credenciais não podem aparecer nos arquivos de configuração de
  # contêiner. Nomes de variáveis e placeholders ${...} são permitidos.
  if grep -EIn --exclude='homologar.sh' \
      '(password[[:space:]]*[:=][[:space:]]*[^${[:space:]]|token[[:space:]]*[:=][[:space:]]*[^${[:space:]]|BEGIN (RSA|OPENSSH|PRIVATE) KEY|AKIA[0-9A-Z]{16})' \
      Dockerfile backend/Dockerfile docker-compose.yml .dockerignore backend/.dockerignore >/dev/null; then
    fail 'Possível credencial literal encontrada nos arquivos de contêiner.'
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$ROOT_DIR/docker-compose.yml" <<'PY'
import sys
from pathlib import Path
try:
    import yaml
except ImportError:
    print('[containers] Aviso: PyYAML ausente; validação estrutural YAML não executada.', file=sys.stderr)
    raise SystemExit(0)
path = Path(sys.argv[1])
with path.open(encoding='utf-8') as stream:
    data = yaml.safe_load(stream)
assert isinstance(data, dict) and isinstance(data.get('services'), dict)
services = data['services']
assert {'frontend', 'backend'} <= set(services)
assert services['frontend']['depends_on']['backend']['condition'] == 'service_healthy'
for name in ('frontend', 'backend'):
    assert 'build' in services[name]
    assert 'environment' in services[name]
    assert 'healthcheck' in services[name]
print('[containers] YAML Compose válido e contém os dois serviços com healthcheck.')
PY
  fi
  log 'Auditoria estática aprovada: multiestágio, usuário node, PORT, healthchecks, contexto e artefatos finais conferidos.'
}

detect_tools() {
  if command -v docker >/dev/null 2>&1; then
    RUNTIME=docker
  elif command -v podman >/dev/null 2>&1; then
    RUNTIME=podman
  elif command -v buildah >/dev/null 2>&1; then
    RUNTIME=buildah
  fi

  if [[ "$RUNTIME" == docker ]] && docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif [[ "$RUNTIME" == podman ]] && podman compose version >/dev/null 2>&1; then
    COMPOSE=(podman compose)
  elif command -v podman-compose >/dev/null 2>&1; then
    COMPOSE=(podman-compose)
  fi
}

build_images() {
  cd "$ROOT_DIR"
  log "Construindo imagem do frontend: ${FRONTEND_IMAGE}"
  if [[ "$RUNTIME" == buildah ]]; then
    buildah bud -f Dockerfile -t "$FRONTEND_IMAGE" .
  else
    "$RUNTIME" build -f Dockerfile -t "$FRONTEND_IMAGE" .
  fi
  log "Construindo imagem do backend: ${BACKEND_IMAGE}"
  if [[ "$RUNTIME" == buildah ]]; then
    buildah bud -f Dockerfile -t "$BACKEND_IMAGE" backend
  else
    "$RUNTIME" build -f backend/Dockerfile -t "$BACKEND_IMAGE" backend
  fi
}

compose_down() {
  [[ ${#COMPOSE[@]} -gt 0 ]] || return 0
  if (( CLEAN_VOLUMES )); then
    "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  else
    "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
  fi
}

runtime_checks() {
  cd "$ROOT_DIR"
  if [[ -z "$RUNTIME" ]]; then
    log 'Docker, Podman e Buildah não encontrados; build e execução reais foram pulados.'
    log 'Execute este mesmo roteiro em uma máquina com Docker Engine e Docker Compose v2.'
    return 0
  fi
  build_images
  if [[ ${#COMPOSE[@]} -eq 0 ]]; then
    log "${RUNTIME} está disponível, mas nenhum Compose compatível foi encontrado; somente o build foi exercitado."
    return 0
  fi

  trap compose_down EXIT
  log 'Subindo os serviços com espera pela saúde do backend.'
  "${COMPOSE[@]}" up -d --no-build
  local deadline=$((SECONDS + 180))
  local service container status
  for service in backend frontend; do
    container=""
    while [[ -z "$container" && $SECONDS -lt $deadline ]]; do
      container="$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
      sleep 2
    done
    [[ -n "$container" ]] || fail "Não foi possível localizar o contêiner do serviço ${service}."
    status=''
    while [[ "$status" != healthy && $SECONDS -lt $deadline ]]; do
      status="$("$RUNTIME" inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
      [[ "$status" == healthy ]] || sleep 3
    done
    [[ "$status" == healthy ]] || fail "Serviço ${service} não ficou healthy dentro do prazo."
    log "${service}: healthy"
  done

  log 'Validando respostas HTTP públicas.'
  curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${FRONTEND_PORT}/" >/dev/null
  curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null
  curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:${BACKEND_PORT}/health/ready" >/dev/null
  log 'Frontend /, backend /health e backend /health/ready responderam 2xx.'

  if (( KEEP_RUNNING )); then
    trap - EXIT
    log 'Serviços mantidos ativos por --keep.'
  else
    compose_down
    trap - EXIT
    log 'Serviços derrubados; volumes persistidos foram preservados.'
  fi
}

static_checks
detect_tools
if (( ! STATIC_ONLY )); then
  runtime_checks
else
  log 'Modo --static-only solicitado; nenhum contêiner foi construído ou iniciado.'
fi

log 'Homologação concluída.'
