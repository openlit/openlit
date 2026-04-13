#!/bin/bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
step()  { echo -e "\n${YELLOW}→${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
EXAMPLES_DIR="$REPO_ROOT/examples"
PIDS_FILE="$SCRIPT_DIR/.demo-pids"

# --- Pre-flight checks ---
if [ "$(uname -s)" != "Linux" ]; then
    error "This demo requires Linux (eBPF). You're on $(uname -s)."
fi

if ! command -v docker >/dev/null 2>&1; then
    error "Docker is required for ClickHouse + OpenLIT. Install: https://docs.docker.com/engine/install/"
fi

if ! command -v python3 >/dev/null 2>&1; then
    error "Python 3 is required for the sample apps. Install: sudo apt install python3 python3-pip"
fi

if [ ! -d "$EXAMPLES_DIR/openai-chat-app" ]; then
    error "Example apps not found at $EXAMPLES_DIR. Make sure you're running from a full repo clone."
fi

# --- Step 1: Infrastructure ---
step "Starting ClickHouse + OpenLIT dashboard (Docker)"
cd "$SCRIPT_DIR"
docker compose up -d
info "Waiting for OpenLIT to become healthy..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:3000 > /dev/null 2>&1; then
        info "OpenLIT is ready at http://localhost:3000"
        break
    fi
    if [ "$i" -eq 60 ]; then
        error "OpenLIT did not become healthy in time. Check: docker compose logs openlit"
    fi
    sleep 2
done

# --- Step 2: Install controller ---
step "Installing OpenLIT Controller"
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)       error "Unsupported architecture: $ARCH" ;;
esac

CONTROLLER_BIN="/usr/local/bin/openlit-controller"
if [ ! -f "$CONTROLLER_BIN" ]; then
    DOWNLOAD_URL="https://github.com/openlit/openlit/releases/latest/download/openlit-controller-linux-${ARCH}.tar.gz"
    info "Downloading controller for linux/${ARCH}..."
    TMP=$(mktemp -d)
    curl -fsSL "$DOWNLOAD_URL" -o "$TMP/controller.tar.gz"
    tar -xzf "$TMP/controller.tar.gz" -C "$TMP"
    sudo install -m 0755 "$TMP/openlit-controller-linux-${ARCH}" "$CONTROLLER_BIN"
    rm -rf "$TMP"
    info "Controller installed at $CONTROLLER_BIN"
else
    info "Controller already installed at $CONTROLLER_BIN"
fi

# --- Step 3: Start controller ---
step "Starting controller (background)"
> "$PIDS_FILE"
sudo OPENLIT_URL=http://127.0.0.1:3000 \
     OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
     "$CONTROLLER_BIN" &
echo "$!" >> "$PIDS_FILE"
info "Controller running (PID $!)"

# --- Step 4: Install Python deps and start sample apps ---
step "Installing Python dependencies for sample apps"
pip3 install -q \
    -r "$EXAMPLES_DIR/openai-chat-app/requirements.txt" \
    -r "$EXAMPLES_DIR/anthropic-chat-app/requirements.txt" \
    -r "$EXAMPLES_DIR/gemini-chat-app/requirements.txt"

step "Starting sample apps from examples/ (background)"

OPENAI_API_KEY="${OPENAI_API_KEY:-demo-key}" \
    python3 "$EXAMPLES_DIR/openai-chat-app/app.py" &
echo "$!" >> "$PIDS_FILE"
info "Started openai-chat-app (PID $!)"

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-demo-key}" \
    python3 "$EXAMPLES_DIR/anthropic-chat-app/app.py" &
echo "$!" >> "$PIDS_FILE"
info "Started anthropic-chat-app (PID $!)"

GEMINI_API_KEY="${GEMINI_API_KEY:-demo-key}" \
    python3 "$EXAMPLES_DIR/gemini-chat-app/app.py" &
echo "$!" >> "$PIDS_FILE"
info "Started gemini-chat-app (PID $!)"

sleep 2
echo ""
info "Demo is running!"
echo ""
echo "  Dashboard:    http://localhost:3000"
echo "  Controller:   running on this host"
echo "  Sample apps:  openai-chat-app, anthropic-chat-app, gemini-chat-app"
echo ""
echo "  View logs:    docker compose logs -f"
echo "  Stop:         sudo bash $SCRIPT_DIR/teardown.sh"
echo ""
