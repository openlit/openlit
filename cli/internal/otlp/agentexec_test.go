package otlp

import (
	"testing"

	"go.opentelemetry.io/otel/trace"
)

func TestContextFromTraceparent(t *testing.T) {
	t.Parallel()
	ctx := contextFromTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")
	sc := trace.SpanContextFromContext(ctx)
	if sc.TraceID().String() != "0af7651916cd43dd8448eb211c80319c" || sc.SpanID().String() != "b7ad6b7169203331" {
		t.Fatalf("got %s %s", sc.TraceID(), sc.SpanID())
	}
	if !sc.IsRemote() {
		t.Fatal("parent must be remote")
	}
}

func TestContextFromTraceparentRejectsBadInput(t *testing.T) {
	t.Parallel()
	for _, value := range []string{"", "garbage", "00-short-b7ad6b7169203331-01", "00-0af7651916cd43dd8448eb211c80319c-zz-01"} {
		if trace.SpanContextFromContext(contextFromTraceparent(value)).IsValid() {
			t.Fatalf("%q must not give a parent", value)
		}
	}
}
