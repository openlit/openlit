#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Tearing down OpenLIT Docker Example ==="
docker compose -f "$SCRIPT_DIR/docker-compose.yaml" down -v --remove-orphans
echo "Done."
