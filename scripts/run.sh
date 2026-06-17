#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
HOST="${HOST:-0.0.0.0}"
NODE_VERSION="${NODE_VERSION:-20.18.1}"
LOCAL_NODE="$HOME/.local/node-v${NODE_VERSION}-linux-x64"

ensure_node() {
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        return 0
    fi

    if [[ -x "$LOCAL_NODE/bin/node" ]]; then
        export PATH="$LOCAL_NODE/bin:$PATH"
        return 0
    fi

    echo "Node.js not found. Installing Node v${NODE_VERSION} to ~/.local ..."
    mkdir -p "$HOME/.local"
    tmp="$HOME/.local/node.tar.xz"
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" -o "$tmp"
    tar -xf "$tmp" -C "$HOME/.local"
    rm -f "$tmp"
    export PATH="$LOCAL_NODE/bin:$PATH"
}

ensure_content_submodule() {
    if [[ -d src/content-sources/oatutor/content-pool ]]; then
        return 0
    fi

    echo "Fetching OATutor-Content submodule ..."
    git submodule update --init --recursive
}

ensure_dependencies() {
    if [[ -d node_modules ]]; then
        return 0
    fi

    echo "Installing npm dependencies ..."
    npm install
}

main() {
    ensure_node
    ensure_content_submodule
    ensure_dependencies

    # Avoid ENOSPC when inotify watch limit is low (large content tree).
    export CHOKIDAR_USEPOLLING="${CHOKIDAR_USEPOLLING:-true}"
    export WATCHPACK_POLLING="${WATCHPACK_POLLING:-true}"

    # Listen on all interfaces so other devices on the LAN can connect.
    export HOST
    export DANGEROUSLY_DISABLE_HOST_CHECK="${DANGEROUSLY_DISABLE_HOST_CHECK:-true}"

    echo ""
    echo "Starting OATutor dev server on all interfaces (port ${PORT})"
    echo "  Local:   http://localhost:${PORT}"
    if command -v hostname >/dev/null 2>&1; then
        lan_ips="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' || true)"
        if [[ -n "$lan_ips" ]]; then
            while IFS= read -r ip; do
                echo "  Network: http://${ip}:${PORT}"
            done <<< "$lan_ips"
        fi
    fi
    echo "Press Ctrl+C to stop."
    echo ""

    export PORT
    export BROWSER="${BROWSER:-none}"
    npm run start
}

main "$@"
