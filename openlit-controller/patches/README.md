# OBI Patches

This directory contains patch files applied on top of the upstream OBI (OpenTelemetry eBPF Instrumentation) v0.8.0 during Docker build.

## Patch Files

- `config.patch` - Adds config types and flags for new GenAI providers (Cohere, Mistral, Groq, Deepseek, Together, Fireworks, Ollama, Azure OpenAI)
- `http_transform.patch` - Adds hostname routing for OpenAI-compatible providers in the HTTP transform layer
- `span.patch` - Adds span subtypes, VendorCohere struct, and getter functions for new providers

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
