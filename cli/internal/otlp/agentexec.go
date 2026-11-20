package otlp

import (
	"context"
	"fmt"

	"github.com/openlit/openlit/sdk/go/semconv"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// CodingAgentSpanExec names the span around `openlit coding exec`. It is
// trace-only: the agent's session is reported by its own native telemetry, so
// this span carries no session id and stays out of the Sessions pages.
const CodingAgentSpanExec = "coding_agent.exec"

// contextFromTraceparent turns a W3C traceparent into a remote parent context.
// An absent or malformed value gives a background context, so the span is a root.
func contextFromTraceparent(value string) context.Context {
	carrier := propagation.MapCarrier{"traceparent": value}
	return propagation.TraceContext{}.Extract(context.Background(), carrier)
}

// StartExec opens the span around `openlit coding exec`. It returns the
// traceparent to hand to the child, and a function that ends the span. Only the
// binary's name is recorded: arguments often hold prompts.
func (e *Emitter) StartExec(parentTraceparent, binary string, captureContent bool) (string, func(exitCode int)) {
	captureMode := "metadata_only"
	if captureContent {
		captureMode = "full"
	}
	ctx, span := e.tracer.Start(
		contextFromTraceparent(parentTraceparent),
		CodingAgentSpanExec,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String(semconv.CodingAgentClient, e.vendor),
			attribute.String(semconv.CodingAgentContentCaptureMode, captureMode),
			attribute.String("process.executable.name", binary),
		),
	)
	carrier := propagation.MapCarrier{}
	propagation.TraceContext{}.Inject(ctx, carrier)

	return carrier["traceparent"], func(exitCode int) {
		span.SetAttributes(attribute.Int("process.exit.code", exitCode))
		if exitCode != 0 {
			span.SetStatus(codes.Error, fmt.Sprintf("exit code %d", exitCode))
		}
		span.End()
	}
}
