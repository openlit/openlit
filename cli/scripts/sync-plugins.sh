#!/usr/bin/env bash
# Mirrors the top-level plugins/ tree into cli/internal/coding/install/plugins/
# so the Go binary's go:embed directive sees the latest manifests.
#
# Run after editing any file under plugins/. CI verifies the embedded copy
# is in sync (see .github/workflows/cli-release.yml).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${CLI_DIR}/.." && pwd)"

SRC="${REPO_ROOT}/plugins"
DEST="${CLI_DIR}/internal/coding/install/plugins"

mkdir -p "${DEST}"

# Wipe the per-vendor subtrees only — the README.md at the root of DEST
# is hand-maintained and shouldn't be clobbered.
for vendor in claude-code cursor codex copilot; do
  rm -rf "${DEST}/${vendor}"
done
# Drop the marketplace folder too if it exists (only used by Claude Code's
# /plugin marketplace add path; not embedded in the binary).
rm -rf "${DEST}/.claude-plugin"

for vendor in claude-code cursor codex copilot; do
  if [ -d "${SRC}/${vendor}" ]; then
    cp -R "${SRC}/${vendor}" "${DEST}/${vendor}"
  fi
done

echo "synced plugins/ -> cli/internal/coding/install/plugins/"
