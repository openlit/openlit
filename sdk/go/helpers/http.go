package helpers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// InstrumentedRoundTripper wraps an http.RoundTripper with OpenTelemetry tracing
type InstrumentedRoundTripper struct {
	base       http.RoundTripper
	tracer     trace.Tracer
	spanName   string
	attributes []trace.SpanStartOption
}

// NewInstrumentedRoundTripper creates a new instrumented round tripper
func NewInstrumentedRoundTripper(base http.RoundTripper, spanName string, opts ...trace.SpanStartOption) *InstrumentedRoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}

	return &InstrumentedRoundTripper{
		base:       base,
		tracer:     otel.Tracer("openlit"),
		spanName:   spanName,
		attributes: opts,
	}
}

// RoundTrip executes a single HTTP transaction with tracing
func (irt *InstrumentedRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx := req.Context()

	// Only create a span if we're not already in one with the same name.
	// This prevents double-instrumentation.
	if span := trace.SpanFromContext(ctx); span.SpanContext().IsValid() {
		return irt.base.RoundTrip(req)
	}

	ctx, span := irt.tracer.Start(ctx, irt.spanName, irt.attributes...)
	defer span.End()

	req = req.WithContext(ctx)

	startTime := time.Now()
	resp, err := irt.base.RoundTrip(req)
	_ = time.Since(startTime)

	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	if resp.StatusCode >= 400 {
		span.SetStatus(codes.Error, resp.Status)
	}

	return resp, nil
}

// SetServerAddressAndPort extracts server address and port from a base URL.
func SetServerAddressAndPort(baseURL string, defaultAddress string, defaultPort int) (string, int) {
	if baseURL == "" {
		return defaultAddress, defaultPort
	}

	address := defaultAddress
	port := defaultPort

	if idx := strings.LastIndex(baseURL, "://"); idx != -1 {
		remaining := baseURL[idx+3:]
		// Strip any path component
		if slashIdx := strings.Index(remaining, "/"); slashIdx != -1 {
			remaining = remaining[:slashIdx]
		}
		if portIdx := strings.LastIndex(remaining, ":"); portIdx != -1 {
			address = remaining[:portIdx]
			portStr := remaining[portIdx+1:]
			if p, err := strconv.Atoi(portStr); err == nil {
				port = p
			}
		} else {
			address = remaining
			if strings.HasPrefix(baseURL, "https") {
				port = 443
			} else if strings.HasPrefix(baseURL, "http") {
				port = 80
			}
		}
	}

	return address, port
}

// RecordError records an error on a span
func RecordError(span trace.Span, err error) {
	if err != nil && span != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
}

// RecordException records an exception with an explicit message on a span
func RecordException(span trace.Span, err error, message string) {
	if err != nil && span != nil {
		span.RecordError(err)
		if message != "" {
			span.SetStatus(codes.Error, message)
		} else {
			span.SetStatus(codes.Error, err.Error())
		}
	}
}
