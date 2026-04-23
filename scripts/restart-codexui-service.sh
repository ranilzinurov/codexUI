#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SERVICE_NAME="${CODEXUI_SERVICE_NAME:-codexui}"
ENV_FILE="${CODEXUI_ENV_FILE:-${HOME}/.config/codexui/codexui.env}"
DEFAULT_PORT="${CODEXUI_PORT:-5901}"
DETACH_LOG="${CODEXUI_RESTART_LOG:-/tmp/codexui-restart.log}"
RUN_AS_USER="${CODEXUI_RUN_AS_USER:-${SUDO_USER:-${USER}}}"
RUN_AS_GROUP="${CODEXUI_RUN_AS_GROUP:-$(id -gn "${RUN_AS_USER}")}"
RUN_AS_HOME="${CODEXUI_RUN_AS_HOME:-}"
RUN_AS_PATH="${CODEXUI_RUN_AS_PATH:-${PATH}}"
RESTART_UNIT_NAME="${CODEXUI_RESTART_UNIT_NAME:-codexui-restart-$(date +%s)}"

if [[ -z "${RUN_AS_HOME}" ]]; then
  RUN_AS_HOME="$(getent passwd "${RUN_AS_USER}" | cut -d: -f6 || true)"
fi
RUN_AS_HOME="${RUN_AS_HOME:-${HOME}}"
export PATH="${RUN_AS_PATH}"

log() {
  printf '[restart] %s %s\n' "$(date -u +%FT%TZ)" "$*"
}

read_port() {
  local port="${DEFAULT_PORT}"
  if [[ -f "${ENV_FILE}" ]]; then
    local env_port
    env_port="$(sed -n 's/^CODEXUI_PORT=//p' "${ENV_FILE}" | tail -n 1 | tr -d '"' | tr -d "'" | xargs || true)"
    if [[ -n "${env_port}" ]]; then
      port="${env_port}"
    fi
  fi
  printf '%s\n' "${port}"
}

wait_for_service() {
  local port="$1"
  local attempts=60
  local sleep_seconds=1

  for ((attempt=1; attempt<=attempts; attempt+=1)); do
    if systemctl is-active --quiet "${SERVICE_NAME}"; then
      if curl -fsS "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep "${sleep_seconds}"
  done

  return 1
}

run_build() {
  if [[ "$(id -u)" -eq 0 ]]; then
    /usr/sbin/runuser -u "${RUN_AS_USER}" -- env HOME="${RUN_AS_HOME}" PATH="${RUN_AS_PATH}" pnpm run build
    return 0
  fi

  pnpm run build
}

run_worker() {
  mkdir -p "$(dirname -- "${DETACH_LOG}")"
  exec >>"${DETACH_LOG}" 2>&1
  trap 'status=$?; log "worker exit status=${status}"' EXIT

  local port
  port="$(read_port)"

  log "unit=${RESTART_UNIT_NAME}"
  log "repo=${REPO_ROOT}"
  log "service=${SERVICE_NAME}"
  log "run_as=${RUN_AS_USER}:${RUN_AS_GROUP}"
  log "port=${port}"
  log "build started"

  cd "${REPO_ROOT}"
  run_build

  log "build finished"
  log "restarting ${SERVICE_NAME}"
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl restart "${SERVICE_NAME}"
  else
    sudo systemctl restart "${SERVICE_NAME}"
  fi

  log "waiting for healthcheck"
  if ! wait_for_service "${port}"; then
    log "service failed healthcheck"
    systemctl status "${SERVICE_NAME}" --no-pager --full || true
    exit 1
  fi

  log "service is healthy"
  systemctl status "${SERVICE_NAME}" --no-pager --full || true
}

schedule_worker() {
  mkdir -p "$(dirname -- "${DETACH_LOG}")"
  : > "${DETACH_LOG}"
  chmod 0644 "${DETACH_LOG}" || true

  sudo systemd-run \
    --unit "${RESTART_UNIT_NAME}" \
    --description "Detached rebuild and restart for ${SERVICE_NAME}" \
    --collect \
    --no-block \
    --service-type=exec \
    --uid "${RUN_AS_USER}" \
    --gid "${RUN_AS_GROUP}" \
    --working-directory "${REPO_ROOT}" \
    -E CODEXUI_SERVICE_NAME="${SERVICE_NAME}" \
    -E CODEXUI_ENV_FILE="${ENV_FILE}" \
    -E CODEXUI_PORT="${DEFAULT_PORT}" \
    -E CODEXUI_RESTART_LOG="${DETACH_LOG}" \
    -E CODEXUI_RUN_AS_USER="${RUN_AS_USER}" \
    -E CODEXUI_RUN_AS_GROUP="${RUN_AS_GROUP}" \
    -E CODEXUI_RUN_AS_HOME="${RUN_AS_HOME}" \
    -E CODEXUI_RUN_AS_PATH="${RUN_AS_PATH}" \
    -E CODEXUI_RESTART_UNIT_NAME="${RESTART_UNIT_NAME}" \
    /bin/bash "${SCRIPT_PATH}" --worker

  echo "Scheduled detached restart worker."
  echo "  unit: ${RESTART_UNIT_NAME}"
  echo "  service: ${SERVICE_NAME}"
  echo "  log: ${DETACH_LOG}"
  echo "Use: tail -f ${DETACH_LOG}"
}

if [[ "${1:-}" == "--worker" ]]; then
  run_worker
  exit 0
fi

schedule_worker
