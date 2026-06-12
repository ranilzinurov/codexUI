#!/usr/bin/env bash
set -euo pipefail

VERSION="${GITLEAKS_VERSION:-8.30.1}"
INSTALL_DIR="${GITLEAKS_INSTALL_DIR:-${HOME}/.local/bin}"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) echo "unsupported OS for gitleaks install: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *) echo "unsupported architecture for gitleaks install: $(uname -m)" >&2; exit 1 ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

archive="${tmp_dir}/gitleaks.tar.gz"
url="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_${os}_${arch}.tar.gz"

curl -fsSL "${url}" -o "${archive}"
tar -xzf "${archive}" -C "${tmp_dir}" gitleaks
mkdir -p "${INSTALL_DIR}"
install -m 0755 "${tmp_dir}/gitleaks" "${INSTALL_DIR}/gitleaks"

if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${INSTALL_DIR}" >> "${GITHUB_PATH}"
fi

"${INSTALL_DIR}/gitleaks" version
