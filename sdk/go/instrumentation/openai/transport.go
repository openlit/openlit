package openai

import (
	"net/http"

	"go.opentelemetry.io/otel/trace"
)

// InstrumentedTransport wraps an HTTP transport with OpenTelemetry instrumentation
type InstrumentedTransport struct {
	base   http.RoundTripper
	tracer trace.Tracer
}

// NewInstrumentedTransport creates a new instrumented transport
func NewInstrumentedTransport(base http.RoundTripper, tracer trace.Tracer) *InstrumentedTransport {
	if base == nil {
		base = http.DefaultTransport
	}

	return &InstrumentedTransport{
		base:   base,
		tracer: tracer,
	}
}

// RoundTrip executes a single HTTP transaction
func (t *InstrumentedTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// The actual tracing is done at the operation level (chat, embedding, etc.)
	// This transport just passes through the request
	return t.base.RoundTrip(req)
}
