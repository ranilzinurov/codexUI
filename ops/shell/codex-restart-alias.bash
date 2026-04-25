# Source this from ~/.bash_aliases to route `codex restart` through the
# systemd-backed restart script instead of starting an unmanaged node process.

codex() {
    if [ "$1" = "restart" ]; then
        local repo_root="${CODEXUI_REPO_ROOT:-/home/rnl1/prog/codexUI}"
        local restart_script="${repo_root}/scripts/restart-codexui-service.sh"

        if [ -x "$restart_script" ]; then
            "$restart_script" --follow
            return $?
        fi

        echo "missing executable codex ui restart script: $restart_script" >&2
        return 1
    fi

    command codex "$@"
}
