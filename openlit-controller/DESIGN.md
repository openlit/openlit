# OpenLIT Controller — Design

This document explains how the controller works and the design principles that
keep it correct. A condensed, enforceable version lives in
`.cursor/rules/controller-design.mdc` (auto-attached when editing controller or
Agents-backend code). Read this for the "why"; read the rule for the "must".

---

## What the controller is

A node-level (Linux/Docker) or cluster-level (Kubernetes) agent that gives
zero-code LLM observability. Three responsibilities:

1. **Discovery** — an eBPF scanner detects processes connecting to LLM
   endpoints and reports them as "discovered" workloads.
2. **Instrumentation** — on request, it instruments a workload via either:
   - **OBI** (OpenTelemetry eBPF Instrumentation) for eBPF payload extraction, or
   - **Python SDK injection** (recreating the container / patching the unit with
     `OTEL_*` env + a bootstrapped `openlit` package).
3. **Reporting** — a poll loop sends discovered/instrumented state to the OpenLIT
   backend and receives pending actions + config. The backend materializes this
   into the Agents page.

```
 process ──(tcp connect)──▶ LLM endpoint
    │                          ▲
 eBPF scanner (kprobe+connscan, IP:port match)
    │ LLMConnectEvent
    ▼
 Engine ── discovered ──▶ poll ──▶ OpenLIT backend ──▶ materializer ──▶ Agents page
    │
    ├── OBI subprocess (payload extraction) ──▶ OTLP ──▶ collector
    └── Python SDK injection (docker/k8s/systemd/bare)
```

---

## Layers

### Discovery (`internal/scanner/`, Linux-only)
- eBPF kprobe on `tcp_v4/v6_connect` + a `/proc/net/tcp` connscan catch both new
  and pre-existing (keep-alive) connections.
- Endpoints are keyed on **IP+port** (BPF map `llm_endpoints`), so self-hosted
  proxies on non-443 ports (LiteLLM :4000, Ollama :11434, vLLM :8000) are matched
  without flagging unrelated traffic to a shared IP.
- Built-in SaaS hosts are resolved by DNS; user `custom_llm_hosts` are added at
  runtime. The resolver reconciles the BPF map with stale-key pruning.

### Engine (`internal/engine/`)
- Owns the service registry, OBI manager, container enricher, and the action
  handlers (instrument/uninstrument, SDK enable/disable, lifecycle start/stop/restart).
- `EnrichProcess` resolves identity + metadata for a PID from `/proc` (+ Docker/K8s).

### Backend contract (`internal/openlit/`, `cmd/controller/main.go`)
- `Poll` sends `PollRequest` (instance + services + action results), receives
  `PollResponse` (pending actions + config). Config is applied only when changed.

### OBI build (`Dockerfile`, `patches/`, `_obi-providers/`)
- OBI is built from a pinned upstream tag; our `patches/` add GenAI providers and
  semconv alignment, and `_obi-providers/` vendors standalone parsers (custom,
  ollama). See `patches/README.md`.

---

## Design principles (the "why")

### Naming authority
The controller discovers a workload *before* OBI runs, so it is the authority on
`service.name`. It resolves the name once and feeds it to all emitters (OBI
target name, SDK `OTEL_SERVICE_NAME`). A user's explicit `OTEL_SERVICE_NAME`
wins, so we never fight an operator's choice. **Why it matters:** the Agents
detail tabs join eBPF traces to an agent by `service_name` equality; if OBI emits
a different name than the controller reported, the workload shows up but its
Overview/Dashboard/Monitoring tabs are empty.

### Identity vs. name are different concerns
`service_name` is for display + matching; `workload_key` is for dedup/identity.
Identity must be **infrastructure-derived** (container/pod), never the
user-overridable name — otherwise enabling `OTEL_SERVICE_NAME` shifts the key and
the UI shows the same workload twice. Identity must also be stable across
restarts so a restart updates the same row.

### Untrusted input boundary
The poll `config` and action payloads come from the backend and are *executed*
by the controller (pip installs, env injection, workload lifecycle). They are
treated as untrusted: `sdk_version` is grammar-validated before it can reach a
shell; the backend validates/sanitizes the whole config before persisting; the
poll body is coerced/capped before the ClickHouse insert.

### Don't break out of sinks
Any value embedded into a structured sink (systemd unit, ClickHouse SQL literal,
pip arg, container selector) is escaped/validated for that sink. One shared
ClickHouse escaper; systemd escaping strips line breaks; container match is exact.

### OBI lifecycle
OBI auto-restarts on crash, so an intentional stop must declare intent (the
`stopping` flag) before signalling, or the supervisor resurrects it. All OBI
config changes flow through `rebuildOBI`.

### Onboarding-friendly auth
The poll endpoint requires an API key once one exists, but serves keyless before
the first key is created — a deliberate trade-off to make first-run fast. It
closes automatically when the operator creates a key.

### Graceful degradation
Backend unreachable, OBI binary missing, BPF load failure — each degrades a
capability without crashing the controller.

---

## Gotchas / history (bugs we've hit — don't reintroduce)

- OBI auto-restarted a workload that was just *stopped* because `Stop()` signals
  SIGTERM before `cancel()` → fixed with the `stopping` flag.
- Agents tabs were empty because OBI emitted `litellm-app` while discovery
  reported `demo-litellm-app` → fixed by making the controller the naming authority.
- `gen_ai.system_instructions` was dropped because the attribute-select list used
  the dotted (`gen_ai.system.instructions`) key instead of the underscore semconv key.
- `custom_llm_hosts` changes didn't reach OBI (no `rebuildOBI`) → fixed.
- A user `OTEL_SERVICE_NAME` could leak into the K8s workload key
  (`stableContainerName` fell back to ServiceName) → fixed to infra-only.
- `sdk_version` from the poll payload was interpolated into a shell → RCE; now
  grammar-validated at ingress.
