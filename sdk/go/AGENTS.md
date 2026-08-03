# Go SDK instructions

These instructions supplement the repository-root `AGENTS.md`.

- Keep this module independently buildable; validate changes with
  `go test ./...` and `go vet ./...`.
- The CLI consumes this module through its local `replace` directive. Preserve
  its public API compatibility unless a coordinated CLI change is intended.
