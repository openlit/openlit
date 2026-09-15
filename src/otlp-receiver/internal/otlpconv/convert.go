package otlpconv

import (
	"encoding/hex"
	"fmt"
	"strconv"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	logspb "go.opentelemetry.io/proto/otlp/logs/v1"
	metricspb "go.opentelemetry.io/proto/otlp/metrics/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

var spanKinds = map[tracepb.Span_SpanKind]string{
	tracepb.Span_SPAN_KIND_UNSPECIFIED: "SPAN_KIND_UNSPECIFIED",
	tracepb.Span_SPAN_KIND_INTERNAL:    "SPAN_KIND_INTERNAL",
	tracepb.Span_SPAN_KIND_SERVER:      "SPAN_KIND_SERVER",
	tracepb.Span_SPAN_KIND_CLIENT:      "SPAN_KIND_CLIENT",
	tracepb.Span_SPAN_KIND_PRODUCER:    "SPAN_KIND_PRODUCER",
	tracepb.Span_SPAN_KIND_CONSUMER:    "SPAN_KIND_CONSUMER",
}

var statusCodes = map[tracepb.Status_StatusCode]string{
	tracepb.Status_STATUS_CODE_UNSET: "STATUS_CODE_UNSET",
	tracepb.Status_STATUS_CODE_OK:    "STATUS_CODE_OK",
	tracepb.Status_STATUS_CODE_ERROR: "STATUS_CODE_ERROR",
}

type TraceRow struct {
	Timestamp          time.Time
	TraceID            string
	SpanID             string
	ParentSpanID       string
	TraceState         string
	SpanName           string
	SpanKind           string
	ServiceName        string
	ResourceAttributes map[string]string
	ScopeName          string
	ScopeVersion       string
	SpanAttributes     map[string]string
	Duration           uint64
	StatusCode         string
	StatusMessage      string
	EventTimestamps    []time.Time
	EventNames         []string
	EventAttributes    []map[string]string
	LinkTraceIDs       []string
	LinkSpanIDs        []string
	LinkTraceStates    []string
	LinkAttributes     []map[string]string
}

type LogRow struct {
	Timestamp          time.Time
	TraceID            string
	SpanID             string
	TraceFlags         uint8
	SeverityText       string
	SeverityNumber     uint8
	ServiceName        string
	Body               string
	ResourceSchemaURL  string
	ResourceAttributes map[string]string
	ScopeSchemaURL     string
	ScopeName          string
	ScopeVersion       string
	ScopeAttributes    map[string]string
	LogAttributes      map[string]string
}

type GaugeRow struct {
	ResourceAttributes map[string]string
	ResourceSchemaURL  string
	ScopeName          string
	ScopeVersion       string
	ScopeAttributes    map[string]string
	ScopeDroppedCount  uint32
	ScopeSchemaURL     string
	ServiceName        string
	MetricName         string
	MetricDescription  string
	MetricUnit         string
	Attributes         map[string]string
	StartTimeUnix      time.Time
	TimeUnix           time.Time
	Value              float64
	Flags              uint32
}

type SumRow struct {
	GaugeRow
	AggregationTemporality int32
	IsMonotonic            bool
}

func AttrMap(kvs []*commonpb.KeyValue) map[string]string {
	out := make(map[string]string, len(kvs))
	for _, kv := range kvs {
		if kv == nil {
			continue
		}
		out[kv.Key] = AnyValue(kv.Value)
	}
	return out
}

func AnyValue(v *commonpb.AnyValue) string {
	if v == nil {
		return ""
	}
	switch x := v.Value.(type) {
	case *commonpb.AnyValue_StringValue:
		return x.StringValue
	case *commonpb.AnyValue_BoolValue:
		return strconv.FormatBool(x.BoolValue)
	case *commonpb.AnyValue_IntValue:
		return strconv.FormatInt(x.IntValue, 10)
	case *commonpb.AnyValue_DoubleValue:
		return strconv.FormatFloat(x.DoubleValue, 'f', -1, 64)
	case *commonpb.AnyValue_BytesValue:
		return hex.EncodeToString(x.BytesValue)
	case *commonpb.AnyValue_ArrayValue:
		return fmt.Sprint(x.ArrayValue)
	case *commonpb.AnyValue_KvlistValue:
		return fmt.Sprint(x.KvlistValue)
	default:
		return ""
	}
}

func ServiceName(res *resourcepb.Resource) string {
	if res == nil {
		return ""
	}
	for _, kv := range res.Attributes {
		if kv != nil && kv.Key == "service.name" {
			return AnyValue(kv.Value)
		}
	}
	return ""
}

func IDHex(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	return hex.EncodeToString(b)
}

func NanoTime(ts uint64) time.Time {
	if ts == 0 {
		return time.Unix(0, 0).UTC()
	}
	return time.Unix(0, int64(ts)).UTC()
}

func Traces(req *tracepb.TracesData) []TraceRow {
	if req == nil {
		return nil
	}
	var rows []TraceRow
	for _, rs := range req.ResourceSpans {
		if rs == nil {
			continue
		}
		resAttrs := AttrMap(nil)
		service := ""
		if rs.Resource != nil {
			resAttrs = AttrMap(rs.Resource.Attributes)
			service = ServiceName(rs.Resource)
		}
		for _, ss := range rs.ScopeSpans {
			if ss == nil {
				continue
			}
			scopeName, scopeVersion := "", ""
			if ss.Scope != nil {
				scopeName = ss.Scope.Name
				scopeVersion = ss.Scope.Version
			}
			for _, span := range ss.Spans {
				if span == nil {
					continue
				}
				statusCode, statusMsg := "STATUS_CODE_UNSET", ""
				if span.Status != nil {
					statusCode = statusCodes[span.Status.Code]
					statusMsg = span.Status.Message
				}
				start := NanoTime(span.StartTimeUnixNano)
				end := NanoTime(span.EndTimeUnixNano)
				var duration uint64
				if span.EndTimeUnixNano > span.StartTimeUnixNano {
					duration = span.EndTimeUnixNano - span.StartTimeUnixNano
				}
				row := TraceRow{
					Timestamp:          start,
					TraceID:            IDHex(span.TraceId),
					SpanID:             IDHex(span.SpanId),
					ParentSpanID:       IDHex(span.ParentSpanId),
					TraceState:         span.TraceState,
					SpanName:           span.Name,
					SpanKind:           spanKinds[span.Kind],
					ServiceName:        service,
					ResourceAttributes: resAttrs,
					ScopeName:          scopeName,
					ScopeVersion:       scopeVersion,
					SpanAttributes:     AttrMap(span.Attributes),
					Duration:           duration,
					StatusCode:         statusCode,
					StatusMessage:      statusMsg,
					EventTimestamps:    make([]time.Time, 0, len(span.Events)),
					EventNames:         make([]string, 0, len(span.Events)),
					EventAttributes:    make([]map[string]string, 0, len(span.Events)),
					LinkTraceIDs:       make([]string, 0, len(span.Links)),
					LinkSpanIDs:        make([]string, 0, len(span.Links)),
					LinkTraceStates:    make([]string, 0, len(span.Links)),
					LinkAttributes:     make([]map[string]string, 0, len(span.Links)),
				}
				_ = end
				for _, ev := range span.Events {
					if ev == nil {
						continue
					}
					row.EventTimestamps = append(row.EventTimestamps, NanoTime(ev.TimeUnixNano))
					row.EventNames = append(row.EventNames, ev.Name)
					row.EventAttributes = append(row.EventAttributes, AttrMap(ev.Attributes))
				}
				for _, link := range span.Links {
					if link == nil {
						continue
					}
					row.LinkTraceIDs = append(row.LinkTraceIDs, IDHex(link.TraceId))
					row.LinkSpanIDs = append(row.LinkSpanIDs, IDHex(link.SpanId))
					row.LinkTraceStates = append(row.LinkTraceStates, link.TraceState)
					row.LinkAttributes = append(row.LinkAttributes, AttrMap(link.Attributes))
				}
				rows = append(rows, row)
			}
		}
	}
	return rows
}

func Logs(req *logspb.LogsData) []LogRow {
	if req == nil {
		return nil
	}
	var rows []LogRow
	for _, rl := range req.ResourceLogs {
		if rl == nil {
			continue
		}
		resAttrs := AttrMap(nil)
		service := ""
		if rl.Resource != nil {
			resAttrs = AttrMap(rl.Resource.Attributes)
			service = ServiceName(rl.Resource)
		}
		for _, sl := range rl.ScopeLogs {
			if sl == nil {
				continue
			}
			scopeName, scopeVersion := "", ""
			scopeAttrs := AttrMap(nil)
			if sl.Scope != nil {
				scopeName = sl.Scope.Name
				scopeVersion = sl.Scope.Version
				scopeAttrs = AttrMap(sl.Scope.Attributes)
			}
			for _, rec := range sl.LogRecords {
				if rec == nil {
					continue
				}
				rows = append(rows, LogRow{
					Timestamp:          NanoTime(rec.TimeUnixNano),
					TraceID:            IDHex(rec.TraceId),
					SpanID:             IDHex(rec.SpanId),
					TraceFlags:         uint8(rec.Flags),
					SeverityText:       rec.SeverityText,
					SeverityNumber:     uint8(rec.SeverityNumber),
					ServiceName:        service,
					Body:               AnyValue(rec.Body),
					ResourceSchemaURL:  rl.SchemaUrl,
					ResourceAttributes: resAttrs,
					ScopeSchemaURL:     sl.SchemaUrl,
					ScopeName:          scopeName,
					ScopeVersion:       scopeVersion,
					ScopeAttributes:    scopeAttrs,
					LogAttributes:      AttrMap(rec.Attributes),
				})
			}
		}
	}
	return rows
}

func GaugesAndSums(req *metricspb.MetricsData) (gauges []GaugeRow, sums []SumRow) {
	if req == nil {
		return nil, nil
	}
	for _, rm := range req.ResourceMetrics {
		if rm == nil {
			continue
		}
		resAttrs := AttrMap(nil)
		service := ""
		resURL := rm.SchemaUrl
		if rm.Resource != nil {
			resAttrs = AttrMap(rm.Resource.Attributes)
			service = ServiceName(rm.Resource)
		}
		for _, sm := range rm.ScopeMetrics {
			if sm == nil {
				continue
			}
			scopeName, scopeVersion, dropped := "", "", uint32(0)
			scopeAttrs := AttrMap(nil)
			if sm.Scope != nil {
				scopeName = sm.Scope.Name
				scopeVersion = sm.Scope.Version
				dropped = sm.Scope.DroppedAttributesCount
				scopeAttrs = AttrMap(sm.Scope.Attributes)
			}
			for _, metric := range sm.Metrics {
				if metric == nil {
					continue
				}
				switch d := metric.Data.(type) {
				case *metricspb.Metric_Gauge:
					if d.Gauge == nil {
						continue
					}
					for _, pt := range d.Gauge.DataPoints {
						if pt == nil {
							continue
						}
						gauges = append(gauges, GaugeRow{
							ResourceAttributes: resAttrs,
							ResourceSchemaURL:  resURL,
							ScopeName:          scopeName,
							ScopeVersion:       scopeVersion,
							ScopeAttributes:    scopeAttrs,
							ScopeDroppedCount:  dropped,
							ScopeSchemaURL:     sm.SchemaUrl,
							ServiceName:        service,
							MetricName:         metric.Name,
							MetricDescription:  metric.Description,
							MetricUnit:         metric.Unit,
							Attributes:         AttrMap(pt.Attributes),
							StartTimeUnix:      NanoTime(pt.StartTimeUnixNano),
							TimeUnix:           NanoTime(pt.TimeUnixNano),
							Value:              numberValue(pt),
							Flags:              uint32(pt.Flags),
						})
					}
				case *metricspb.Metric_Sum:
					if d.Sum == nil {
						continue
					}
					for _, pt := range d.Sum.DataPoints {
						if pt == nil {
							continue
						}
						base := GaugeRow{
							ResourceAttributes: resAttrs,
							ResourceSchemaURL:  resURL,
							ScopeName:          scopeName,
							ScopeVersion:       scopeVersion,
							ScopeAttributes:    scopeAttrs,
							ScopeDroppedCount:  dropped,
							ScopeSchemaURL:     sm.SchemaUrl,
							ServiceName:        service,
							MetricName:         metric.Name,
							MetricDescription:  metric.Description,
							MetricUnit:         metric.Unit,
							Attributes:         AttrMap(pt.Attributes),
							StartTimeUnix:      NanoTime(pt.StartTimeUnixNano),
							TimeUnix:           NanoTime(pt.TimeUnixNano),
							Value:              numberValue(pt),
							Flags:              uint32(pt.Flags),
						}
						sums = append(sums, SumRow{
							GaugeRow:               base,
							AggregationTemporality: int32(d.Sum.AggregationTemporality),
							IsMonotonic:            d.Sum.IsMonotonic,
						})
					}
				}
			}
		}
	}
	return gauges, sums
}

func numberValue(pt *metricspb.NumberDataPoint) float64 {
	if pt == nil {
		return 0
	}
	switch v := pt.Value.(type) {
	case *metricspb.NumberDataPoint_AsDouble:
		return v.AsDouble
	case *metricspb.NumberDataPoint_AsInt:
		return float64(v.AsInt)
	default:
		return 0
	}
}
