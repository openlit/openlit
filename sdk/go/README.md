# OpenLIT Go SDK

OpenTelemetry-native observability SDK for LLM applications in Go. Monitor your AI applications with automatic instrumentation for popular LLM providers.

[![Go Reference](https://pkg.go.dev/badge/github.com/openlit/openlit/sdk/go.svg)](https://pkg.go.dev/github.com/openlit/openlit/sdk/go)
[![Go Report Card](https://goreportcard.com/badge/github.com/openlit/openlit/sdk/go)](https://goreportcard.com/report/github.com/openlit/openlit/sdk/go)

## Features

- 🚀 **One-line initialization** - Get started with minimal code
- 📊 **OpenTelemetry-native** - Built on OpenTelemetry standards
- 💰 **Cost tracking** - Automatic cost calculation for LLM requests
- 📈 **Metrics collection** - Token usage, latency, and performance metrics
- 🔄 **Streaming support** - Full support for streaming responses
- 🔌 **Flexible integration** - Works with multiple Go client libraries

## Supported Integrations

- ✅ **OpenAI** - Chat completions, embeddings, images, audio
- ✅ **Anthropic** - Messages API with tool calling support

## Installation

```bash
go get github.com/openlit/openlit/sdk/go
```

## Quick Start

### 1. Initialize OpenLIT

```go
package main

import (
    "context"
    "log"
    
    "github.com/openlit/openlit/sdk/go"
)

func main() {
    // Initialize OpenLIT
    err := openlit.Init(openlit.Config{
        OtlpEndpoint:    "http://127.0.0.1:4318",
        Environment:     "production",
        ApplicationName: "my-go-app",
    })
    if err != nil {
        log.Fatalf("Failed to initialize OpenLIT: %v", err)
    }
    defer openlit.Shutdown(context.Background())
    
    // Your application code here
}
```

### 2. Instrument OpenAI

```go
import (
    "github.com/openlit/openlit/sdk/go/instrumentation/openai"
    openai_sdk "github.com/sashabaranov/go-openai"
)

// Create and instrument OpenAI client
client := openai_sdk.NewClient("your-api-key")
instrumentedClient := openai.Instrument(client)

// Use as normal - automatically traced!
resp, err := instrumentedClient.CreateChatCompletion(ctx, openai_sdk.ChatCompletionRequest{
    Model: openai_sdk.GPT4,
    Messages: []openai_sdk.ChatCompletionMessage{
        {
            Role:    openai_sdk.ChatMessageRoleUser,
            Content: "Hello!",
        },
    },
})
```

### 3. Instrument Anthropic

```go
import (
    "github.com/openlit/openlit/sdk/go/instrumentation/anthropic"
)

// Create and instrument Anthropic client
client := anthropic.NewClient("your-api-key")
instrumentedClient := anthropic.Instrument(client)

// Use as normal - automatically traced!
resp, err := instrumentedClient.CreateMessage(ctx, anthropic.MessageRequest{
    Model: "claude-3-5-sonnet-20241022",
    Messages: []anthropic.Message{
        {
            Role:    "user",
            Content: "Hello!",
        },
    },
    MaxTokens: 1024,
})
```

## Configuration Options

```go
config := openlit.Config{
    // Required
    OtlpEndpoint:    "http://127.0.0.1:4318",  // OTLP endpoint
    
    // Optional
    Environment:     "production",              // Deployment environment
    ApplicationName: "my-go-app",              // Application name
    ServiceVersion:  "1.0.0",                  // Service version
    
    // OTLP Configuration
    OtlpHeaders:     map[string]string{},      // Custom OTLP headers
    
    // Feature Flags
    DisableTracing:  false,                    // Disable tracing
    DisableMetrics:  false,                    // Disable metrics
    DisableBatch:    false,                    // Disable batch processing
    
    // Timeouts
    TraceExporterTimeout:  10 * time.Second,   // Trace export timeout
    MetricExporterTimeout: 10 * time.Second,   // Metric export timeout
    MetricExportInterval:  30 * time.Second,   // Metric export interval
    
    // Pricing
    PricingEndpoint:    "",                    // Custom pricing endpoint
    DisablePricingFetch: false,                // Disable pricing fetch
    PricingInfo:        map[string]ModelPricing{}, // Custom pricing
}
```

## Streaming Support

Both OpenAI and Anthropic integrations support streaming responses:

### OpenAI Streaming

```go
stream, err := instrumentedClient.CreateChatCompletionStream(ctx, request)
if err != nil {
    log.Fatal(err)
}
defer stream.Close()

for {
    response, err := stream.Recv()
    if errors.Is(err, io.EOF) {
        break
    }
    if err != nil {
        log.Fatal(err)
    }
    
    fmt.Printf(response.Choices[0].Delta.Content)
}
```

### Anthropic Streaming

```go
stream, err := instrumentedClient.CreateMessageStream(ctx, request)
if err != nil {
    log.Fatal(err)
}
defer stream.Close()

for {
    event, err := stream.Recv()
    if errors.Is(err, io.EOF) {
        break
    }
    if err != nil {
        log.Fatal(err)
    }
    
    // Handle event
}
```

## Collected Telemetry

### Traces

- Operation name and type (chat, embedding, etc.)
- Request and response models
- Input/output messages
- Token usage (input, output, total)
- Cost calculations
- Response times
- Error details

### Metrics

- `gen_ai.client.token.usage` - Token usage counter
- `gen_ai.client.operation.duration` - Operation duration histogram
- `gen_ai.server.time_to_first_token` - TTFT for streaming
- `gen_ai.server.time_per_output_token` - TBT for streaming

### Attributes

All traces include standard OpenTelemetry semantic conventions:
- `gen_ai.operation.name`
- `gen_ai.system`
- `gen_ai.request.model`
- `gen_ai.response.model`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `server.address`
- `server.port`

## Advanced Usage

### Custom Pricing

Provide custom pricing information for models:

```go
config := openlit.Config{
    PricingInfo: map[string]openlit.ModelPricing{
        "gpt-4-custom": {
            InputCostPerToken:  0.00003,
            OutputCostPerToken: 0.00006,
        },
    },
}
```

### Custom Headers

Add custom headers to OTLP exports:

```go
config := openlit.Config{
    OtlpHeaders: map[string]string{
        "Authorization": "Bearer token",
        "X-Custom-Header": "value",
    },
}
```

## Integration with OpenLIT Dashboard

The Go SDK works seamlessly with the [OpenLIT Dashboard](https://github.com/openlit/openlit):

1. Start OpenLIT stack:
```bash
docker compose up -d
```

2. Configure SDK to send data:
```go
openlit.Init(openlit.Config{
    OtlpEndpoint: "http://localhost:4318",
})
```

3. View your traces at http://localhost:3000

## Examples

See the [examples/](examples/) directory for complete working examples:
- [OpenAI Chat Completion](examples/openai/chat/)
- [OpenAI Streaming](examples/openai/streaming/)
- [Anthropic Messages](examples/anthropic/messages/)
- [Anthropic Streaming](examples/anthropic/streaming/)

## Rule Engine - `openlit.EvaluateRule()`

Evaluate trace attributes against the OpenLIT Rule Engine to retrieve matching rules and associated entities (contexts, prompts, evaluation configurations). This function does **not** require `openlit.Init()` — it is a standalone HTTP call.

### Parameters (`EvaluateRuleOptions`)

| Field              | Type                    | Description                                                                 |
|--------------------|-------------------------|-----------------------------------------------------------------------------|
| `URL`              | `string`                | OpenLIT dashboard URL. Falls back to `OPENLIT_URL` env, then `http://127.0.0.1:3000`. |
| `APIKey`           | `string`                | Bearer token. Falls back to `OPENLIT_API_KEY` env.                          |
| `EntityType`       | `RuleEntityType`        | `RuleEntityContext`, `RuleEntityPrompt`, or `RuleEntityEvaluation`.         |
| `Fields`           | `map[string]interface{}`| Trace attributes to evaluate against rules.                                 |
| `IncludeEntityData`| `bool`                  | If true, include full entity data in response.                              |
| `EntityInputs`     | `map[string]interface{}`| Optional inputs for entity resolution (e.g. prompt variables).              |
| `Timeout`          | `time.Duration`         | HTTP timeout. Default: 30s.                                                 |

### Example

```go
result, err := openlit.EvaluateRule(ctx, openlit.EvaluateRuleOptions{
    EntityType: openlit.RuleEntityContext,
    Fields: map[string]interface{}{
        "gen_ai.system":        "openai",
        "gen_ai.request.model": "gpt-4",
        "service.name":         "my-app",
    },
    IncludeEntityData: true,
})
if err != nil {
    log.Fatal(err)
}
fmt.Println("Matching rules:", result.MatchingRuleIDs)
fmt.Println("Entities:", result.Entities)
```

## Requirements

- Go 1.21 or higher
- OpenTelemetry Collector or compatible backend

## Contributing

We welcome contributions! See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

Apache License 2.0 - see [LICENSE](../../LICENSE)

## Support

- 📚 [Documentation](https://docs.openlit.io/)
- 💬 [Slack Community](https://join.slack.com/t/openlit/shared_invite/zt-2etnfttwg-TjP_7BZXfYg84oAukY8QRQ)
- 🐛 [Issue Tracker](https://github.com/openlit/openlit/issues)
