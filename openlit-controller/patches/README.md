# OBI Patches

This directory contains patch files applied on top of upstream OBI (OpenTelemetry
eBPF Instrumentation) **v0.9.0** during the Docker build (see the obi-builder stage
in `../Dockerfile`).

## What we add

OBI v0.9.0 natively supports OpenAI, Anthropic, Gemini, Qwen, Bedrock, MCP,
Embedding, and Rerank. On top of that we add two GenAI extractors:

- **`custom`** — a generic OpenAI-compatible gateway extractor (LiteLLM, vLLM,
  LocalAI, OpenRouter, Ollama's `/v1/` endpoint, ...). It reuses upstream
  `OpenAISpan` and is safe to enable broadly because `OpenAISpan` returns
  `ok=false` on non-OpenAI-shaped bodies. Spans report no provider name (the
  backend vendor behind the gateway is unknown); discovery (IP+port) is the
  authoritative attribution.
- **`ollama`** — a parser for Ollama's NATIVE API (`/api/chat`, `/api/generate`),
  whose JSON schema differs from OpenAI (`prompt_eval_count`/`eval_count`,
  `message.content`/`response`). Path-gated so it never matches the `/v1/` path.

## Files

- `providers/ollama/ollama.go` (in the repo root, NOT a patch) — the standalone
  `OllamaSpan` parser. The Dockerfile copies `providers/*/*.go` into
  `pkg/ebpf/common/http/` before applying patches.
- `config.patch` — adds `CustomConfig` + `OllamaConfig` to `GenAIConfig` and ORs
  them into `GenAIConfig.Enabled()`.
- `span.patch` — adds `HTTPSubtypeCustom` (15) + `HTTPSubtypeOllama` (16), extends
  `IsGenAISubtype`, adds the `Custom *VendorOpenAI` and `Ollama *VendorOllama`
  fields + the `VendorOllama` struct, and extends the GenAI getters.
- `http_transform.patch` — adds the routing branches (`OllamaSpan` for the native
  path; `OpenAISpan` reused for `custom`, placed last) in `http_transform.go`, and
  the per-subtype trace-attribute emission in `tracesgen.go`.

## Re-creating / rebasing patches (e.g. for the next OBI version)

```bash
git clone --depth 1 --branch <version> <OBI_REPO> /tmp/obi-rebase
cd /tmp/obi-rebase
cp <repo>/openlit-controller/providers/ollama/ollama.go pkg/ebpf/common/http/
# edit the four files, then:
git diff -- pkg/config/payload_extraction.go > <repo>/openlit-controller/patches/config.patch
git diff -- pkg/appolly/app/request/span.go   > <repo>/openlit-controller/patches/span.patch
git diff -- pkg/ebpf/common/http_transform.go pkg/export/otel/tracesgen/tracesgen.go > <repo>/openlit-controller/patches/http_transform.patch
```

Verify on a clean checkout: copy `ollama.go` in, then `git apply --check patches/*.patch`.
