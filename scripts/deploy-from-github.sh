#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${CODEXUI_REPO_ROOT:-/home/rnl1/prog/codexUI}"
REMOTE="${CODEXUI_DEPLOY_REMOTE:-origin}"
BRANCH="${CODEXUI_DEPLOY_BRANCH:-main}"
STATIC_DIST_DIR="${CODEXUI_STATIC_DIST_DIR:-/var/www/codexui-dist}"
RESTART_SCRIPT="${CODEXUI_RESTART_SCRIPT:-scripts/restart-codexui-service.sh}"
REQUESTED_REF="${1:-${SSH_ORIGINAL_COMMAND:-}}"

log() {
  printf '[deploy] %s %s\n' "$(date -u +%FT%TZ)" "$*"
}

fail() {
  log "error: $*"
  exit 1
}

validate_ref() {
  local value="$1"
  [[ -z "${value}" || "${value}" =~ ^[0-9a-fA-F]{7,40}$ ]] || fail "expected a git SHA, got '${value}'"
}

cd "${REPO_ROOT}"

if [[ -n "$(git status --porcelain)" && "${CODEXUI_DEPLOY_ALLOW_DIRTY:-0}" != "1" ]]; then
  fail "working tree is dirty; commit, stash, or set CODEXUI_DEPLOY_ALLOW_DIRTY=1 intentionally"
fi

validate_ref "${REQUESTED_REF}"

log "fetching ${REMOTE}/${BRANCH}"
git fetch --prune "${REMOTE}" "${BRANCH}"

REMOTE_REF="refs/remotes/${REMOTE}/${BRANCH}"
if [[ -n "${REQUESTED_REF}" ]]; then
  TARGET_SHA="$(git rev-parse --verify "${REQUESTED_REF}^{commit}")"
  git merge-base --is-ancestor "${TARGET_SHA}" "${REMOTE_REF}" \
    || fail "${TARGET_SHA} is not reachable from ${REMOTE}/${BRANCH}"
else
  TARGET_SHA="$(git rev-parse --verify "${REMOTE_REF}^{commit}")"
fi

log "checking out ${TARGET_SHA}"
git reset --hard "${TARGET_SHA}"

if command -v corepack >/dev/null 2>&1; then
  log "enabling package manager from package.json"
  corepack enable
fi

log "installing dependencies"
pnpm install --frozen-lockfile

log "rebuilding and restarting service"
CODEXUI_STATIC_DIST_DIR="${STATIC_DIST_DIR}" bash "${RESTART_SCRIPT}" --follow

log "deploy complete"
