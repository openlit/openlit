# Embedded plugin manifests

This directory is mirrored from the top-level `plugins/` at build time so
the `openlit coding install` subcommand carries every vendor's host plugin
manifest in its binary. See `cli/internal/coding/install/install_vendors.go`
and the `//go:embed plugins/*` directive there for the embed entry point.

Per-vendor manifests:

- `claude-code/` — Claude Code's `.claude-plugin/` + hooks.json
- `cursor/` — Cursor's `.cursor-plugin/` + hooks.json + scripts/run.sh
- `codex/` — Codex's `.codex-plugin/` + hooks/hooks.json

The build mirror is performed by the project root Makefile / CI (see
`scripts/sync-plugins.sh`). Local development can also run
`make sync-plugins` to refresh the embedded copy after editing files
under the top-level `plugins/`.
