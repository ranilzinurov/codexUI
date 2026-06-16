#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_PATH="${GITLEAKS_CONFIG:-${REPO_ROOT}/.gitleaks.toml}"
BASELINE_PATH="${GITLEAKS_BASELINE:-${REPO_ROOT}/.gitleaks-baseline.json}"
REPORT_DIR="${GITLEAKS_REPORT_DIR:-${REPO_ROOT}/output/gitleaks}"
REPORT_PATH="${REPORT_DIR}/findings.json"

if ! command -v gitleaks >/dev/null 2>&1; then
  fallback_gitleaks="${GITLEAKS_INSTALL_DIR:-${HOME}/.local/bin}/gitleaks"
  if [[ -x "${fallback_gitleaks}" ]]; then
    GITLEAKS_BIN="${fallback_gitleaks}"
  else
    echo "gitleaks is not installed. Install it or run scripts/install-gitleaks.sh first." >&2
    exit 127
  fi
else
  GITLEAKS_BIN="gitleaks"
fi

mkdir -p "${REPORT_DIR}"

args=(
  git
  --no-banner
  --redact=100
  --config "${CONFIG_PATH}"
  --report-format json
  --report-path "${REPORT_PATH}"
)

if [[ -f "${BASELINE_PATH}" ]]; then
  args+=(--baseline-path "${BASELINE_PATH}")
fi

args+=("${REPO_ROOT}")

"${GITLEAKS_BIN}" "${args[@]}"
