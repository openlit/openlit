#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== OpenLIT Docker Example Setup ==="
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

# ── 2. Tear down any existing stack ──────────────────────────────────────
echo "Cleaning up any existing stack..."
docker compose -f "$SCRIPT_DIR/docker-compose.yaml" down -v --remove-orphans 2>/dev/null || true
echo ""

# ── 3. Start sample apps first, then controller ─────────────────────────
echo "Starting infrastructure (ClickHouse, OTEL Collector, Dashboard)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yaml" up -d clickhouse otel-collector openlit

echo "Waiting for ClickHouse to be healthy..."
until docker inspect --format='{{.State.Health.Status}}' openlit-clickhouse 2>/dev/null | grep -q healthy; do
  sleep 2
done
echo "ClickHouse ready."

echo ""
echo "Starting sample apps (before controller, to test discovery)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yaml" up -d openai-app gemini-app bedrock-app

echo "Letting sample apps make LLM API calls for 15 seconds..."
sleep 15
echo ""

echo "Starting OpenLIT Controller (Docker mode — discovers running containers)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yaml" up -d openlit-controller
echo ""

# ── 4. Print access instructions ────────────────────────────────────────
echo "=== Setup Complete ==="
echo ""
echo "  Mode: Docker"
echo "  Containers:"
echo "    - openai-app     : Python OpenAI client"
echo "    - gemini-app     : Python Gemini client"
echo "    - bedrock-app    : Python Bedrock client"
echo ""
echo "  Controller was deployed AFTER apps — it should discover existing LLM connections."
echo ""
echo "  Dashboard: http://localhost:3000"
echo ""
echo "  To check controller logs:"
echo "    docker logs -f openlit-controller"
echo ""
echo "  To tear down:"
echo "    bash $(basename "$SCRIPT_DIR")/teardown.sh"
