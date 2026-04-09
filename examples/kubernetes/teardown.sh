#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Removing OpenLIT resources from cluster..."
kubectl delete -k "$SCRIPT_DIR" --ignore-not-found
echo "Done. Cluster is still running."
