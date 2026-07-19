package mistral

import (
	"context"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

const (
	defaultBaseURL       = "https://api.mistral.ai/v1"
	defaultServerAddress = "api.mistral.ai"
	defaultServerPort    = 443
)

// InstrumentedClient wraps an HTTP client with mistral instrumentation.
// mistral exposes an OpenAI-compatible API, so we point baseURL at the
// local mistral server instead of api.openai.com.
type InstrumentedClient struct {
	httpClient *http.Client
	tracer     trace.Tracer
	baseURL    string
	apiKey     string
}

// NewClient creates a new instrumented mistral client.
// baseURL should point to your mistral server, e.g. "https://api.mistral.ai/v1".
// apiKey is optional for local mistral deployments — pass an empty string if not needed.
func NewClient(baseURL string, opts ...ClientOption) *InstrumentedClient {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	client := &InstrumentedClient{
		httpClient: &http.Client{},
		tracer:     otel.Tracer("openlit.mistral"),
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     "",
	}

	for _, opt := range opts {
		opt(client)
	}

	// Re-trim in case WithBaseURL-style options ever appear; keep path stable.
	client.baseURL = strings.TrimRight(client.baseURL, "/")

	client.httpClient.Transport = NewInstrumentedTransport(
		client.httpClient.Transport,
		client.tracer,
	)

	ensureMetrics()

	return client
}

// ClientOption is a functional option for configuring the client
type ClientOption func(*InstrumentedClient)

// WithAPIKey sets an API key (optional for local mistral deployments)
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

func (c *InstrumentedClient) chatCompletionsURL() string {
	return c.baseURL + "/chat/completions"
}

// CreateChatCompletion sends a chat completion request to mistral
func (c *InstrumentedClient) CreateChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	return c.createChatCompletion(ctx, req)
}

// CreateChatCompletionStream sends a streaming chat completion request to mistral
func (c *InstrumentedClient) CreateChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionStream, error) {
	return c.createChatCompletionStream(ctx, req)
}
