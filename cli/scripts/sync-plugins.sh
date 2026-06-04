#!/usr/bin/env bash
# Assembles the embedded marketplace tree under
#   cli/internal/coding/install/marketplace/
# from the two canonical source-of-truth locations at the repo root:
#   .claude-plugin/marketplace.json   (root marketplace manifest)
#   plugins/<vendor>/                 (per-vendor plugin manifests)
#
# Layout produced (identical to the repo-root layout so a single
# marketplace.json works for both Claude's GitHub-source fetch and the
# CLI's local materialize path):
#
#   marketplace/
#     .claude-plugin/marketplace.json     -- mirrored from repo-root
#     plugins/claude-code/                -- mirrored from repo-root
#     plugins/cursor/                     -- mirrored from repo-root
#     plugins/codex/                      -- mirrored from repo-root
#
# Run after editing any file under either source tree. CI verifies the
# embedded copy is in sync (see .github/workflows/cli-tests.yml).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${CLI_DIR}/.." && pwd)"

SRC_MARKETPLACE="${REPO_ROOT}/.claude-plugin"
SRC_PLUGINS="${REPO_ROOT}/plugins"
DEST="${CLI_DIR}/internal/coding/install/marketplace"

if [ ! -f "${SRC_MARKETPLACE}/marketplace.json" ]; then
  echo "sync-plugins: missing ${SRC_MARKETPLACE}/marketplace.json" >&2
  exit 1
fi
if [ ! -d "${SRC_PLUGINS}" ]; then
  echo "sync-plugins: missing ${SRC_PLUGINS}/" >&2
  exit 1
fi

# Wipe the dest tree wholesale so deletions in the source (e.g. dropping
# a vendor) propagate. The README at the dest root is hand-maintained
# and lives outside the wiped paths, so it survives.
rm -rf "${DEST}/.claude-plugin" "${DEST}/plugins"

mkdir -p "${DEST}/.claude-plugin" "${DEST}/plugins"

cp "${SRC_MARKETPLACE}/marketplace.json" "${DEST}/.claude-plugin/marketplace.json"

for vendor_dir in "${SRC_PLUGINS}"/*/; do
  vendor=$(basename "${vendor_dir}")
  cp -R "${vendor_dir}" "${DEST}/plugins/${vendor}"
done

echo "synced: .claude-plugin/ + plugins/ -> cli/internal/coding/install/marketplace/"
