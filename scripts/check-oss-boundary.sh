#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if find src/client/src/ee deploy/enterprise deploy/cloud -mindepth 0 -maxdepth 0 -print -quit 2>/dev/null | grep -q .; then
  echo "Enterprise-only paths cannot exist in the OSS repository."
  exit 1
fi

if rg -n 'src/client/src/ee|@/ee' src --glob '!*.md'; then
  echo "Enterprise-only imports cannot be referenced by OSS code."
  exit 1
fi
