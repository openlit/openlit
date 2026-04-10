#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== OpenLIT Linux Example Setup ==="
echo ""
echo "This demo simulates a bare Linux host where the controller"
echo "and sample Python apps run as regular processes (no Docker/K8s)."
echo ""

for cmd in docker; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' is required but not installed."
    exit 1
  fi
done

# ── 1. Build images ──────────────────────────────────────────────────────
echo "Building OpenLIT Dashboard image..."
docker build -t openlit:local "$REPO_ROOT/src" --quiet
echo ""

echo "Building OpenLIT Controller image..."
docker build -t openlit-controller:local "$REPO_ROOT/openlit-controller" --quiet
echo ""

echo "Building Linux host simulation image..."
docker build -t openlit-linux-host:local -f "$SCRIPT_DIR/Dockerfile.host" "$SCRIPT_DIR"
echo ""

# ── 2. Tear down any existing stack ──────────────────────────────────────
echo "Cleaning up any existing stack..."
docker compose -f "$SCRIPT_DIR/docker-compose.yaml" down -v --remove-orphans 2>/dev/null || true
echo ""

# ── 3. Start infrastructure ─────────────────────────────────────────────
echo "Starting infrastructure (ClickHouse, OTEL Collector, Dashboard)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yaml" up -d clickhouse otel-collector openlit

echo "Waiting for ClickHouse to be healthy..."
until docker inspect --format='{{.State.Health.Status}}' openlit-clickhouse 2>/dev/null | grep -q healthy; do
  sleep 2
done
echo "ClickHouse ready."
echo ""

# ── 4. Start the Linux host container ───────────────────────────────────
echo "Starting Linux host (controller + sample apps as processes)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yaml" up -d linux-host
echo ""

echo "=== Setup Complete ==="
echo ""
echo "  Mode: Linux (simulated via Docker container)"
echo "  The 'linux-host' container runs:"
echo "    - openai_app.py   : Python OpenAI client (background process)"
echo "    - gemini_app.py   : Python Gemini client (background process)"
echo "    - bedrock_app.py  : Python Bedrock client (background process)"
echo "    - openlit-controller : in Linux mode (foreground)"
echo ""
echo "  Dashboard: http://localhost:3000"
echo ""
echo "  To check controller + app logs:"
echo "    docker logs -f openlit-linux-host"
echo ""
echo "  To tear down:"
echo "    bash $(basename "$SCRIPT_DIR")/teardown.sh"
