# OpAMP server instructions

These instructions supplement the repository-root `AGENTS.md`.

- This is an independent Go module. Validate code changes with `go test ./...`.
- Treat certificate and supervisor configuration changes as security-sensitive:
  preserve TLS verification in production and do not add secrets to examples or
  logs.
