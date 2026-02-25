package anthropic

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

// InstrumentedClient wraps an Anthropic client with instrumentation
type InstrumentedClient struct {
	httpClient *http.Client
	tracer     trace.Tracer
	baseURL    string
	apiKey     string
	apiVersion string
}

// NewClient creates a new instrumented Anthropic client
func NewClient(apiKey string, opts ...ClientOption) *InstrumentedClient {
	client := &InstrumentedClient{
		httpClient: &http.Client{},
		tracer:     otel.Tracer("openlit.anthropic"),
		baseURL:    "https://api.anthropic.com/v1",
		apiKey:     apiKey,
		apiVersion: "2023-06-01",
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

// WithAPIVersion sets a custom API version
func WithAPIVersion(apiVersion string) ClientOption {
	return func(c *InstrumentedClient) {
		c.apiVersion = apiVersion
	}
}

// Instrument wraps an existing Anthropic client library
func Instrument(client interface{}) interface{} {
	// Placeholder for wrapping existing client libraries
	return client
}

// GetHTTPClient returns the instrumented HTTP client
func (c *InstrumentedClient) GetHTTPClient() *http.Client {
	return c.httpClient
}

// CreateMessage sends a message request to Anthropic
func (c *InstrumentedClient) CreateMessage(ctx context.Context, req MessageRequest) (*MessageResponse, error) {
	return c.createMessage(ctx, req, false)
}

// CreateMessageStream sends a streaming message request to Anthropic
func (c *InstrumentedClient) CreateMessageStream(ctx context.Context, req MessageRequest) (*MessageStream, error) {
	return c.createMessageStream(ctx, req)
}
