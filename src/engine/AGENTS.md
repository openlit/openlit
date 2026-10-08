# OpenLIT engine instructions

These instructions supplement the repository-root `AGENTS.md`.

- This is an independent Go module. Validate with `go test ./...`.
- Keep the `go` directive compatible with the Go version pinned in `src/Dockerfile`.
- Do not log `CRON_JOB_SECRET`, NATS credentials, or signal payload contents.
- Never trust a signal's tenant fields over its subject; reject mismatches.
- The engine is closed in Community Edition: rules come only from the UI server's internal rules route. Custom rules and destination delivery are provided by the enterprise overlay on the server side, not in this module.
