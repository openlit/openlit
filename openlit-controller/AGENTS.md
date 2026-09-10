# Controller instructions

These instructions supplement the repository-root `AGENTS.md`.

- The controller is a separate Go module with eBPF code; read
  `../agent-guides/controller-design.md` before changing discovery or
  instrumentation behavior.
- Run `go test -race -count=1 ./...` for ordinary Go changes. eBPF changes
  also require a Linux host with BTF support and `make setup-bpf generate`.
- Do not update `.obi-src` or vendor provider files without following the
  Makefile's submodule and vendor targets.
