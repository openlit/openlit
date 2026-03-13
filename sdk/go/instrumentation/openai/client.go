package openai

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

// InstrumentedClient wraps any OpenAI client with instrumentation
type InstrumentedClient struct {
	httpClient *http.Client
	tracer     trace.Tracer
	baseURL    string
	apiKey     string
}

// NewClient creates a new instrumented OpenAI client
func NewClient(apiKey string, opts ...ClientOption) *InstrumentedClient {
	client := &InstrumentedClient{
		httpClient: &http.Client{},
		tracer:     otel.Tracer("openlit.openai"),
		baseURL:    "https://api.openai.com/v1",
		apiKey:     apiKey,
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

// WithBaseURL sets a custom base URL
func WithBaseURL(baseURL string) ClientOption {
	return func(c *InstrumentedClient) {
		c.baseURL = baseURL
	}
}

// WithHTTPClient sets a custom HTTP client
func WithHTTPClient(httpClient *http.Client) ClientOption {
	return func(c *InstrumentedClient) {
		c.httpClient = httpClient
	}
}

// Instrument wraps an existing OpenAI client library
// This works with popular Go OpenAI libraries by wrapping their HTTP transport
func Instrument(client interface{}) interface{} {
	// This is a placeholder for the actual instrumentation logic
	// The implementation will depend on the specific client library being used
	// For now, we'll return the client as-is
	return client
}

// GetHTTPClient returns the instrumented HTTP client for use with other libraries
func (c *InstrumentedClient) GetHTTPClient() *http.Client {
	return c.httpClient
}

// CreateChatCompletion sends a chat completion request
func (c *InstrumentedClient) CreateChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	return c.createChatCompletion(ctx, req, false)
}

// CreateChatCompletionStream sends a streaming chat completion request
func (c *InstrumentedClient) CreateChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionStream, error) {
	return c.createChatCompletionStream(ctx, req)
}

// CreateEmbedding sends an embedding request
func (c *InstrumentedClient) CreateEmbedding(ctx context.Context, req EmbeddingRequest) (*EmbeddingResponse, error) {
	return c.createEmbedding(ctx, req)
}

// CreateImage sends an image generation request
func (c *InstrumentedClient) CreateImage(ctx context.Context, req ImageRequest) (*ImageResponse, error) {
	return c.createImage(ctx, req)
}
