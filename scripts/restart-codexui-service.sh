#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
SERVICE_NAME="${CODEXUI_SERVICE_NAME:-codexui}"
ENV_FILE="${CODEXUI_ENV_FILE:-${HOME}/.config/codexui/env}"
DEFAULT_PORT="${CODEXUI_PORT:-5900}"
STATIC_DIST_DIR="${CODEXUI_STATIC_DIST_DIR:-}"
DETACH_LOG="${CODEXUI_RESTART_LOG:-/tmp/codexui-restart.log}"
RUN_AS_USER="${CODEXUI_RUN_AS_USER:-${SUDO_USER:-${USER}}}"
RUN_AS_GROUP="${CODEXUI_RUN_AS_GROUP:-$(id -gn "${RUN_AS_USER}")}"
RUN_AS_HOME="${CODEXUI_RUN_AS_HOME:-}"
RUN_AS_PATH="${CODEXUI_RUN_AS_PATH:-${PATH}}"
RESTART_UNIT_NAME="${CODEXUI_RESTART_UNIT_NAME:-codexui-restart-$(date +%s)}"
FOLLOW_RESTART_PROGRESS=0

if [[ -z "${RUN_AS_HOME}" ]]; then
  RUN_AS_HOME="$(getent passwd "${RUN_AS_USER}" | cut -d: -f6 || true)"
fi
RUN_AS_HOME="${RUN_AS_HOME:-${HOME}}"
export PATH="${RUN_AS_PATH}"

log() {
  printf '[restart] %s %s\n' "$(date -u +%FT%TZ)" "$*"
}

progress() {
  printf '%s\n' "$*"
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

stop_unmanaged_codexui_instances() {
  local port="$1"
  local entrypoint="${REPO_ROOT}/dist-cli/index.js"
  local main_pid
  main_pid="$(systemctl show "${SERVICE_NAME}" -p MainPID --value 2>/dev/null || true)"

  local pids=()
  local port_listener_pids=" "
  mapfile -t pids < <(pgrep -f "${entrypoint}" 2>/dev/null || true)
  if command -v ss >/dev/null 2>&1; then
    local listener_line
    while IFS= read -r listener_line; do
      while [[ "${listener_line}" =~ pid=([0-9]+) ]]; do
        pids+=("${BASH_REMATCH[1]}")
        port_listener_pids+="${BASH_REMATCH[1]} "
        listener_line="${listener_line#*pid=${BASH_REMATCH[1]}}"
      done
    done < <(ss -H -ltnp "sport = :${port}" 2>/dev/null || true)
  fi

  local stale_pids=()
  local seen_pids=" "
  local pid
  for pid in "${pids[@]}"; do
    [[ -n "${pid}" ]] || continue
    [[ "${seen_pids}" != *" ${pid} "* ]] || continue
    seen_pids+="${pid} "
    [[ "${pid}" != "$$" ]] || continue

    local cmdline
    cmdline="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
    [[ "${cmdline}" == *"${entrypoint}"* ]] || continue

    local cgroup
    cgroup="$(cat "/proc/${pid}/cgroup" 2>/dev/null || true)"
    if [[ "${pid}" == "${main_pid}" && "${cgroup}" == *"/${SERVICE_NAME}.service"* ]]; then
      continue
    fi
    if [[ "${cgroup}" == *"/${SERVICE_NAME}.service"* ]]; then
      continue
    fi

    if [[ "${port_listener_pids}" == *" ${pid} "* || "${cmdline}" == *"--port ${port}"* || "${cmdline}" == *"--port=${port}"* ]]; then
      stale_pids+=("${pid}")
    fi
  done

  if [[ "${#stale_pids[@]}" -eq 0 ]]; then
    return 0
  fi

  log "terminating unmanaged codexui process(es) on port ${port}: ${stale_pids[*]}"
  kill -TERM "${stale_pids[@]}" 2>/dev/null || true

  local attempt
  for ((attempt=1; attempt<=10; attempt+=1)); do
    local alive_pids=()
    for pid in "${stale_pids[@]}"; do
      if kill -0 "${pid}" 2>/dev/null; then
        alive_pids+=("${pid}")
      fi
    done

    if [[ "${#alive_pids[@]}" -eq 0 ]]; then
      return 0
    fi

    stale_pids=("${alive_pids[@]}")
    sleep 1
  done

  log "force killing unmanaged codexui process(es) on port ${port}: ${stale_pids[*]}"
  kill -KILL "${stale_pids[@]}" 2>/dev/null || true
}

wait_for_restart_healthcheck() {
  local port="$1"

  log "waiting for healthcheck"
  if wait_for_service "${port}"; then
    return 0
  fi

  log "healthcheck failed; cleaning stale codexui listener(s) on port ${port} and retrying restart"
  stop_unmanaged_codexui_instances "${port}"
  log "retrying ${SERVICE_NAME}"
  restart_service

  log "waiting for healthcheck after retry"
  wait_for_service "${port}"
}

follow_restart_progress() {
  local timeout_seconds="${CODEXUI_RESTART_FOLLOW_TIMEOUT:-300}"
  local deadline=$((SECONDS + timeout_seconds))
  local position=0
  local line_count
  local line

  progress "Перезапуск ${SERVICE_NAME} запланирован ⏳"
  progress "Сборка ожидаем ⏳"

  while (( SECONDS < deadline )); do
    if [[ -f "${DETACH_LOG}" ]]; then
      line_count="$(wc -l <"${DETACH_LOG}" | tr -d '[:space:]')"
      line_count="${line_count:-0}"

      if (( line_count > position )); then
        while IFS= read -r line; do
          case "${line}" in
            *"build started"*)
              progress "Сборка началась ⏳"
              ;;
            *"build finished"*)
              progress "Сборка завершена ✅"
              ;;
            *"static dist sync started"*)
              progress "Статику обновляем ⏳"
              ;;
            *"static dist sync finished"*)
              progress "Статика обновлена ✅"
              ;;
            *"terminating unmanaged codexui process"*|*"force killing unmanaged codexui process"*)
              progress "Старые процессы останавливаем ⏳"
              ;;
            *"restarting ${SERVICE_NAME}"*)
              progress "Сервис ${SERVICE_NAME} перезапускаем ⏳"
              ;;
            *"waiting for healthcheck"*)
              progress "Сервис ${SERVICE_NAME} ожидаем ⏳"
              ;;
            *"healthcheck failed; cleaning stale codexui listener"*)
              progress "Healthcheck не прошёл, чистим порт и пробуем ещё раз ⏳"
              ;;
            *"service is healthy"*)
              progress "Сервис ${SERVICE_NAME} перезапущен ✅"
              ;;
            *"service failed healthcheck"*)
              progress "Сервис ${SERVICE_NAME} не прошёл healthcheck ❌"
              progress "Лог: ${DETACH_LOG}"
              return 1
              ;;
            *"worker exit status=0"*)
              progress "Перезапуск завершён ✅"
              return 0
              ;;
            *"worker exit status="*)
              progress "Перезапуск завершился с ошибкой ❌"
              progress "Лог: ${DETACH_LOG}"
              return 1
              ;;
          esac
        done < <(tail -n "+$((position + 1))" "${DETACH_LOG}")
        position="${line_count}"
      fi
    fi

    sleep 1
  done

  progress "Перезапуск ещё выполняется ⏳"
  progress "Лог: ${DETACH_LOG}"
  return 124
}

restart_service() {
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl restart "${SERVICE_NAME}"
    return 0
  fi

  if sudo -n systemctl restart "${SERVICE_NAME}" >/dev/null 2>&1; then
    return 0
  fi

  local restart_policy
  restart_policy="$(systemctl show "${SERVICE_NAME}" -p Restart --value 2>/dev/null || true)"
  local main_pid
  main_pid="$(systemctl show "${SERVICE_NAME}" -p MainPID --value 2>/dev/null || true)"
  local service_user
  service_user="$(systemctl show "${SERVICE_NAME}" -p User --value 2>/dev/null || true)"

  if [[ "${restart_policy}" == "always" && "${service_user}" == "$(id -un)" && "${main_pid}" =~ ^[0-9]+$ && "${main_pid}" != "0" ]]; then
    log "no passwordless sudo; terminating main pid ${main_pid} and relying on Restart=always"
    kill -TERM "${main_pid}"
    return 0
  fi

  log "cannot restart ${SERVICE_NAME}: passwordless sudo for 'systemctl restart ${SERVICE_NAME}' is not available, and Restart=always fallback is not applicable"
  return 1
}

run_build() {
  if [[ "$(id -u)" -eq 0 ]]; then
    /usr/sbin/runuser -u "${RUN_AS_USER}" -- env HOME="${RUN_AS_HOME}" PATH="${RUN_AS_PATH}" pnpm run build
    return 0
  fi

  pnpm run build
}

sync_static_dist() {
  [[ -n "${STATIC_DIST_DIR}" ]] || return 0

  local source_dir="${REPO_ROOT}/dist/"
  local target_dir="${STATIC_DIST_DIR%/}/"
  [[ -d "${source_dir}" ]] || {
    log "dist directory does not exist after build: ${source_dir}"
    return 1
  }
  command -v rsync >/dev/null 2>&1 || {
    log "cannot sync static dist: rsync is not installed"
    return 1
  }

  log "static dist sync started target=${target_dir}"
  if [[ "$(id -u)" -eq 0 ]]; then
    mkdir -p "${target_dir}"
    rsync -a --delete "${source_dir}" "${target_dir}"
  elif [[ -d "${target_dir}" && -w "${target_dir}" ]]; then
    rsync -a --delete "${source_dir}" "${target_dir}"
  elif sudo -n true >/dev/null 2>&1; then
    sudo -n mkdir -p "${target_dir}"
    sudo -n rsync -a --delete "${source_dir}" "${target_dir}"
  else
    log "cannot sync static dist to ${target_dir}: no write access and sudo is not passwordless"
    return 1
  fi
  log "static dist sync finished"
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
  sync_static_dist
  stop_unmanaged_codexui_instances "${port}"
  log "restarting ${SERVICE_NAME}"
  restart_service

  if ! wait_for_restart_healthcheck "${port}"; then
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

  if sudo -n systemd-run \
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
    -E CODEXUI_STATIC_DIST_DIR="${STATIC_DIST_DIR}" \
    -E CODEXUI_RESTART_LOG="${DETACH_LOG}" \
    -E CODEXUI_RUN_AS_USER="${RUN_AS_USER}" \
    -E CODEXUI_RUN_AS_GROUP="${RUN_AS_GROUP}" \
    -E CODEXUI_RUN_AS_HOME="${RUN_AS_HOME}" \
    -E CODEXUI_RUN_AS_PATH="${RUN_AS_PATH}" \
    -E CODEXUI_RESTART_UNIT_NAME="${RESTART_UNIT_NAME}" \
    /bin/bash "${SCRIPT_PATH}" --worker 2>/dev/null; then

    echo "Scheduled detached restart worker."
    echo "  unit: ${RESTART_UNIT_NAME}"
    echo "  service: ${SERVICE_NAME}"
    echo "  log: ${DETACH_LOG}"
    if [[ "${FOLLOW_RESTART_PROGRESS}" == "1" ]]; then
      follow_restart_progress
    else
      echo "Use: tail -f ${DETACH_LOG}"
    fi
    return 0
  fi

  log "passwordless sudo for systemd-run is not available; using same-cgroup fallback worker"
  CODEXUI_STATIC_DIST_DIR="${STATIC_DIST_DIR}" nohup /bin/bash "${SCRIPT_PATH}" --worker >/dev/null 2>&1 &
  echo "Scheduled fallback restart worker."
  echo "  service: ${SERVICE_NAME}"
  echo "  log: ${DETACH_LOG}"
  if [[ "${FOLLOW_RESTART_PROGRESS}" == "1" ]]; then
    follow_restart_progress
  fi
}

while [[ "${#}" -gt 0 ]]; do
  case "${1}" in
    --worker)
      run_worker
      exit 0
      ;;
    --follow)
      FOLLOW_RESTART_PROGRESS=1
      shift
      ;;
    --no-follow)
      FOLLOW_RESTART_PROGRESS=0
      shift
      ;;
    *)
      echo "unknown restart option: ${1}" >&2
      exit 2
      ;;
  esac
done

schedule_worker
