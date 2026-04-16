#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
info() { echo -e "${GREEN}[✓]${NC} $*"; }
step() { echo -e "\n${RED}→${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIDS_FILE="$SCRIPT_DIR/.demo-pids"

# --- Stop background processes ---
step "Stopping sample apps and controller"
if [ -f "$PIDS_FILE" ]; then
    while IFS= read -r pid; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            sudo kill "$pid" 2>/dev/null || true
            info "Stopped PID $pid"
        fi
    done < "$PIDS_FILE"
    rm -f "$PIDS_FILE"
else
    echo "  No PID file found — killing by process name"
fi

pkill -f "openai-chat-app/app.py" 2>/dev/null || true
pkill -f "anthropic-chat-app/app.py" 2>/dev/null || true
pkill -f "gemini-chat-app/app.py" 2>/dev/null || true
pkill -f "crewai-agent-app/app.py" 2>/dev/null || true
sudo pkill -f "openlit-controller" 2>/dev/null || true

# --- Stop Docker services ---
step "Stopping ClickHouse + OpenLIT (Docker)"
cd "$SCRIPT_DIR"
docker compose down -v 2>/dev/null || true

info "Teardown complete."
echo ""
echo "  To also uninstall the controller binary:"
echo "    sudo rm /usr/local/bin/openlit-controller"
echo ""
