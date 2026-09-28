package otlpconv

import (
	"encoding/hex"
	"testing"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	metricspb "go.opentelemetry.io/proto/otlp/metrics/v1"
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

func TestStampResourceKeepsDeploymentEnvironment(t *testing.T) {
	t.Parallel()
	stamped := StampResource(map[string]string{
		"service.name":           "demo",
		"deployment.environment": "local",
	}, ResourceTenant{
		OrganisationID: "org-1",
		ProjectID:      "proj-1",
		Environment:    "staging",
	})
	if stamped["deployment.environment"] != "local" {
		t.Fatalf("env=%s", stamped["deployment.environment"])
	}
	if stamped["gen_ai.environment"] != "" {
		t.Fatalf("gen_ai env=%s", stamped["gen_ai.environment"])
	}
	if stamped["organisation.environment.name"] != "staging" {
		t.Fatalf("org env=%s", stamped["organisation.environment.name"])
	}
	if stamped["openlit.organisation.id"] != "org-1" || stamped["openlit.project.id"] != "proj-1" {
		t.Fatalf("tenant attrs %+v", stamped)
	}
	if stamped["service.name"] != "demo" {
		t.Fatal("lost original attr")
	}
}

func TestAnyValueStructuredJSON(t *testing.T) {
	t.Parallel()
	array := AnyValue(&commonpb.AnyValue{Value: &commonpb.AnyValue_ArrayValue{
		ArrayValue: &commonpb.ArrayValue{Values: []*commonpb.AnyValue{
			{Value: &commonpb.AnyValue_StringValue{StringValue: "a"}},
			{Value: &commonpb.AnyValue_IntValue{IntValue: 2}},
		}},
	}})
	if array != `["a",2]` {
		t.Fatalf("array=%s", array)
	}
	kv := AnyValue(&commonpb.AnyValue{Value: &commonpb.AnyValue_KvlistValue{
		KvlistValue: &commonpb.KeyValueList{Values: []*commonpb.KeyValue{
			{Key: "model", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "gpt"}}},
		}},
	}})
	if kv != `{"model":"gpt"}` {
		t.Fatalf("kv=%s", kv)
	}
}

func TestMarshalJSONDropsOversizedValues(t *testing.T) {
	t.Parallel()
	huge := make([]byte, maxEncodedAnyValue+1)
	for i := range huge {
		huge[i] = 'a'
	}
	if got := marshalJSON(string(huge)); got != "" {
		t.Fatalf("got len=%d want empty", len(got))
	}
	if got := marshalJSON("ok"); got != `"ok"` {
		t.Fatalf("got=%s", got)
	}
}

func TestUnknownStatusAndKindFallBack(t *testing.T) {
	t.Parallel()
	rows := Traces(&tracepb.TracesData{
		ResourceSpans: []*tracepb.ResourceSpans{{
			ScopeSpans: []*tracepb.ScopeSpans{{
				Spans: []*tracepb.Span{{
					Name:   "unknown",
					Kind:   tracepb.Span_SpanKind(99),
					Status: &tracepb.Status{Code: tracepb.Status_StatusCode(99), Message: "future"},
				}},
			}},
		}},
	})
	if len(rows) != 1 {
		t.Fatalf("len=%d", len(rows))
	}
	if rows[0].StatusCode != "STATUS_CODE_UNSET" {
		t.Fatalf("status=%s", rows[0].StatusCode)
	}
	if rows[0].SpanKind != "SPAN_KIND_UNSPECIFIED" {
		t.Fatalf("kind=%s", rows[0].SpanKind)
	}
	if rows[0].StatusMessage != "future" {
		t.Fatalf("msg=%s", rows[0].StatusMessage)
	}
}

func TestMetricsMapsHistogramSummaryAndExpHistogram(t *testing.T) {
	t.Parallel()
	req := &metricspb.MetricsData{
		ResourceMetrics: []*metricspb.ResourceMetrics{{
			Resource: &resourcepb.Resource{Attributes: []*commonpb.KeyValue{
				{Key: "service.name", Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "gpu"}}},
			}},
			ScopeMetrics: []*metricspb.ScopeMetrics{{
				Metrics: []*metricspb.Metric{
					{
						Name: "http.server.duration",
						Data: &metricspb.Metric_Histogram{Histogram: &metricspb.Histogram{
							AggregationTemporality: metricspb.AggregationTemporality_AGGREGATION_TEMPORALITY_CUMULATIVE,
							DataPoints: []*metricspb.HistogramDataPoint{{
								Count:          3,
								Sum:            ptrFloat(6),
								BucketCounts:   []uint64{1, 2},
								ExplicitBounds: []float64{1},
								Min:            ptrFloat(0.1),
								Max:            ptrFloat(4),
							}},
						}},
					},
					{
						Name: "rpc.latency",
						Data: &metricspb.Metric_Summary{Summary: &metricspb.Summary{
							DataPoints: []*metricspb.SummaryDataPoint{{
								Count: 2,
								Sum:   3,
								QuantileValues: []*metricspb.SummaryDataPoint_ValueAtQuantile{
									{Quantile: 0.5, Value: 1.5},
								},
							}},
						}},
					},
					{
						Name: "gen_ai.client.token.usage",
						Data: &metricspb.Metric_ExponentialHistogram{ExponentialHistogram: &metricspb.ExponentialHistogram{
							AggregationTemporality: metricspb.AggregationTemporality_AGGREGATION_TEMPORALITY_DELTA,
							DataPoints: []*metricspb.ExponentialHistogramDataPoint{{
								Count:     4,
								Sum:       ptrFloat(8),
								Scale:     1,
								ZeroCount: 1,
								Positive:  &metricspb.ExponentialHistogramDataPoint_Buckets{Offset: 2, BucketCounts: []uint64{3}},
							}},
						}},
					},
				},
			}},
		}},
	}
	rows := Metrics(req)
	if len(rows.Histograms) != 1 || rows.Histograms[0].Count != 3 || rows.Histograms[0].Sum != 6 {
		t.Fatalf("histograms=%+v", rows.Histograms)
	}
	if len(rows.Summaries) != 1 || rows.Summaries[0].Count != 2 || len(rows.Summaries[0].Quantiles) != 1 {
		t.Fatalf("summaries=%+v", rows.Summaries)
	}
	if len(rows.ExpHistograms) != 1 || rows.ExpHistograms[0].ZeroCount != 1 || rows.ExpHistograms[0].PositiveOffset != 2 {
		t.Fatalf("exp=%+v", rows.ExpHistograms)
	}
}

func ptrFloat(v float64) *float64 { return &v }
