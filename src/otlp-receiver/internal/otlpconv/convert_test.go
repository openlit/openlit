package otlpconv

import (
	"encoding/hex"
	"testing"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

func TestTracesMapping(t *testing.T) {
	t.Parallel()
	traceID, _ := hex.DecodeString("0af7651916cd43dd8448eb211c80319c")
	spanID, _ := hex.DecodeString("b7ad6b7169203331")
	start := uint64(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC).UnixNano())
	end := start + 1_500_000
	rows := Traces(&tracepb.TracesData{
		ResourceSpans: []*tracepb.ResourceSpans{{
			Resource: &resourcepb.Resource{Attributes: []*commonpb.KeyValue{
				{Key: "service.name", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "demo"}}},
			}},
			ScopeSpans: []*tracepb.ScopeSpans{{
				Scope: &commonpb.InstrumentationScope{Name: "lib", Version: "1"},
				Spans: []*tracepb.Span{{
					TraceId:           traceID,
					SpanId:            spanID,
					Name:              "chat",
					Kind:              tracepb.Span_SPAN_KIND_CLIENT,
					StartTimeUnixNano: start,
					EndTimeUnixNano:   end,
					Attributes: []*commonpb.KeyValue{
						{Key: "gen_ai.system", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "openai"}}},
					},
					Status: &tracepb.Status{Code: tracepb.Status_STATUS_CODE_OK},
				}},
			}},
		}},
	})
	if len(rows) != 1 {
		t.Fatalf("len=%d", len(rows))
	}
	row := rows[0]
	if row.ServiceName != "demo" || row.SpanName != "chat" || row.SpanKind != "SPAN_KIND_CLIENT" {
		t.Fatalf("row=%+v", row)
	}
	if row.Duration != 1_500_000 || row.StatusCode != "STATUS_CODE_OK" {
		t.Fatalf("duration/status %+v", row)
	}
	if row.TraceID != "0af7651916cd43dd8448eb211c80319c" || row.SpanAttributes["gen_ai.system"] != "openai" {
		t.Fatalf("ids/attrs %+v", row)
	}
}
