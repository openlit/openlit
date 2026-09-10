# CLI instructions

These instructions supplement the repository-root `AGENTS.md`.

- This is a Go module. Validate changes with `go build -trimpath ./...` and
  `go test -race -count=1 ./...`.
- Changes to `plugins/` or `.claude-plugin/` must be synchronized with the
  embedded marketplace tree by running `bash scripts/sync-plugins.sh`.
- Keep hook telemetry compatible with the applicable canonical guides in
  `../agent-guides/`.
