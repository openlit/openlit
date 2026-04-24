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

if ! command -v go >/dev/null 2>&1; then
    error "Go is required to build the controller from source. Install: https://go.dev/doc/install"
fi

if [ ! -d "$EXAMPLES_DIR/openai-chat-app" ]; then
    error "Example apps not found at $EXAMPLES_DIR. Make sure you're running from a full repo clone."
fi

# --- Step 1: Build OpenLIT Docker image from source ---
step "Building OpenLIT Docker image from source"
docker build -t openlit:local "$REPO_ROOT/src"
info "OpenLIT image built"

# --- Step 2: Infrastructure ---
step "Starting ClickHouse + OpenLIT dashboard (Docker)"
cd "$SCRIPT_DIR"
docker compose up -d --build
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

# --- Step 3: Build controller from source ---
step "Building OpenLIT Controller from source"
CONTROLLER_DIR="$REPO_ROOT/openlit-controller"
CONTROLLER_BIN="$CONTROLLER_DIR/openlit-controller"

cd "$CONTROLLER_DIR"
make setup-bpf generate 2>/dev/null || true
CGO_ENABLED=0 go build -o "$CONTROLLER_BIN" ./cmd/controller
sudo install -m 0755 "$CONTROLLER_BIN" /usr/local/bin/openlit-controller
rm -f "$CONTROLLER_BIN"
info "Controller built and installed at /usr/local/bin/openlit-controller"

# --- Step 4: Start controller ---
step "Starting controller (background)"
> "$PIDS_FILE"
sudo OPENLIT_URL=http://127.0.0.1:3000 \
     OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
     /usr/local/bin/openlit-controller &
echo "$!" >> "$PIDS_FILE"
info "Controller running (PID $!)"

# --- Step 5: Install Python deps and start sample apps ---
step "Installing Python dependencies for sample apps"
pip3 install -q \
    -r "$EXAMPLES_DIR/openai-chat-app/requirements.txt" \
    -r "$EXAMPLES_DIR/anthropic-chat-app/requirements.txt" \
    -r "$EXAMPLES_DIR/gemini-chat-app/requirements.txt" \
    -r "$EXAMPLES_DIR/crewai-agent-app/requirements.txt"

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

OPENAI_API_KEY="${OPENAI_API_KEY:-demo-key}" \
    python3 "$EXAMPLES_DIR/crewai-agent-app/app.py" &
echo "$!" >> "$PIDS_FILE"
info "Started crewai-agent-app (PID $!)"

sleep 2
echo ""
info "Demo is running!"
echo ""
echo "  Dashboard:    http://localhost:3000"
echo "  Controller:   running on this host"
echo "  Sample apps:  openai-chat-app, anthropic-chat-app, gemini-chat-app, crewai-agent-app"
echo ""
echo "  View logs:    docker compose logs -f"
echo "  Stop:         sudo bash $SCRIPT_DIR/teardown.sh"
echo ""
