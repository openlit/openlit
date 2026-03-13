# Changelog

All notable changes to the OpenLIT Go SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-26

### Added
- Initial release of the OpenLIT Go SDK
- OpenTelemetry-native instrumentation for OpenAI (chat completions, streaming, embeddings, image generation)
- OpenTelemetry-native instrumentation for Anthropic (messages, streaming, tool use)
- Automatic token usage tracking with `gen_ai.client.token.usage` histogram
- Operation duration metric `gen_ai.client.operation.duration`
- Streaming metrics: `gen_ai.server.time_to_first_token`, `gen_ai.server.time_per_output_token`, `gen_ai.client.operation.time_to_first_chunk`, `gen_ai.client.operation.time_per_output_chunk`, `gen_ai.server.request.duration`
- Error-path metrics with `error.type` dimension on all non-streaming operations
- Automatic cost calculation using built-in pricing data
- Prompt cache token tracking for Anthropic (`cache_creation_input_tokens`, `cache_read_input_tokens`)
- `DisableCaptureMessageContent` flag for privacy-sensitive workloads
- Configurable OTLP endpoint, headers, export interval, and timeouts
- `openlit.sdk.version` resource attribute on all telemetry
- OTel semantic conventions alignment with Python and TypeScript SDKs
