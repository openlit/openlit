package vllm

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

// InstrumentedClient wraps an HTTP client with vLLM instrumentation.
// vLLM exposes an OpenAI-compatible API, so we point baseURL at the
// local vLLM server instead of api.openai.com.
type InstrumentedClient struct {
	httpClient *http.Client
	tracer     trace.Tracer
	baseURL    string
	apiKey     string
}

// NewClient creates a new instrumented vLLM client.
// baseURL should point to your vLLM server, e.g. "http://127.0.0.1:8000/v1".
// apiKey is optional for local vLLM deployments — pass an empty string if not needed.
func NewClient(baseURL string, opts ...ClientOption) *InstrumentedClient {
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8000/v1"
	}

	client := &InstrumentedClient{
		httpClient: &http.Client{},
		tracer:     otel.Tracer("openlit.vllm"),
		baseURL:    baseURL,
		apiKey:     "",
	}

	for _, opt := range opts {
		opt(client)
	}

	// Wrap the HTTP client with instrumentation
	client.httpClient.Transport = NewInstrumentedTransport(
		client.httpClient.Transport,
		client.tracer,
	)

	return client
}

// ClientOption is a functional option for configuring the client
type ClientOption func(*InstrumentedClient)

// WithAPIKey sets an API key (optional for local vLLM deployments)
func WithAPIKey(apiKey string) ClientOption {
	return func(c *InstrumentedClient) {
		c.apiKey = apiKey
	}
}

// WithHTTPClient sets a custom HTTP client
func WithHTTPClient(httpClient *http.Client) ClientOption {
	return func(c *InstrumentedClient) {
		c.httpClient = httpClient
	}
}

// GetHTTPClient returns the instrumented HTTP client
func (c *InstrumentedClient) GetHTTPClient() *http.Client {
	return c.httpClient
}

// CreateChatCompletion sends a chat completion request to vLLM
func (c *InstrumentedClient) CreateChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	return c.createChatCompletion(ctx, req)
}

// CreateChatCompletionStream sends a streaming chat completion request to vLLM
func (c *InstrumentedClient) CreateChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionStream, error) {
	return c.createChatCompletionStream(ctx, req)
}
