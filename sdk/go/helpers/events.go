package helpers

import (
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/openlit/openlit/sdk/go/semconv"
)

// EmitInferenceEvent records the GenAI client inference operation details event.
// Matches the Python/TS emitInferenceEvent behaviour.
func EmitInferenceEvent(span trace.Span, attrs []attribute.KeyValue) {
	if span == nil {
		return
	}
	span.AddEvent(semconv.GenAIClientInferenceOperationDetails, trace.WithAttributes(attrs...))
}
