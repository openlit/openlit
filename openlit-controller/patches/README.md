# OBI Patches

This directory contains patch files applied to the upstream OBI (OpenTelemetry eBPF Instrumentation) submodule in `.obi-src/` during `make vendor-providers`.

## Patch Files

- `http_transform.patch` - Adds hostname routing for new providers in the HTTP transform layer
- `span.patch` - Adds span types for new GenAI providers
- `span_getters.patch` - Adds getter functions for provider-specific attributes
- `tracesgen.patch` - Adds trace generation for new providers
- `metrics.patch` - Adds metrics export for new providers
- `prom.patch` - Adds Prometheus metric export
- `config.patch` - Adds config flags for enabling/disabling providers

## Creating Patches

After modifying files in `.obi-src/`, generate patches:

```bash
cd .obi-src
git diff > ../patches/<name>.patch
```

## Applying Patches

Patches are applied automatically by `make vendor-providers`. To apply manually:

```bash
cd .obi-src && git apply ../patches/<name>.patch
```
