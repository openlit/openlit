package otlpconv

import (
	"encoding/hex"
	"encoding/json"
	"strconv"
	"time"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	logspb "go.opentelemetry.io/proto/otlp/logs/v1"
	metricspb "go.opentelemetry.io/proto/otlp/metrics/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

const maxEncodedAnyValue = 1 << 20

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

func spanKindName(kind tracepb.Span_SpanKind) string {
	if name, ok := spanKinds[kind]; ok {
		return name
	}
	return "SPAN_KIND_UNSPECIFIED"
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

type HistogramRow struct {
	GaugeRow
	Count                  uint64
	Sum                    float64
	BucketCounts           []uint64
	ExplicitBounds         []float64
	Min                    float64
	Max                    float64
	AggregationTemporality int32
}

type SummaryRow struct {
	GaugeRow
	Count     uint64
	Sum       float64
	Quantiles []float64
	Values    []float64
}

type ExpHistogramRow struct {
	GaugeRow
	Count                  uint64
	Sum                    float64
	Scale                  int32
	ZeroCount              uint64
	PositiveOffset         int32
	PositiveBucketCounts   []uint64
	NegativeOffset         int32
	NegativeBucketCounts   []uint64
	Min                    float64
	Max                    float64
	AggregationTemporality int32
}

type MetricRows struct {
	Gauges        []GaugeRow
	Sums          []SumRow
	Histograms    []HistogramRow
	Summaries     []SummaryRow
	ExpHistograms []ExpHistogramRow
}

func metricBase(resAttrs map[string]string, resURL, scopeName, scopeVersion string, scopeAttrs map[string]string, dropped uint32, scopeURL, service string, metric *metricspb.Metric, attrs []*commonpb.KeyValue, start, unix uint64, flags uint32) GaugeRow {
	name, desc, unit := "", "", ""
	if metric != nil {
		name, desc, unit = metric.Name, metric.Description, metric.Unit
	}
	return GaugeRow{
		ResourceAttributes: resAttrs,
		ResourceSchemaURL:  resURL,
		ScopeName:          scopeName,
		ScopeVersion:       scopeVersion,
		ScopeAttributes:    scopeAttrs,
		ScopeDroppedCount:  dropped,
		ScopeSchemaURL:     scopeURL,
		ServiceName:        service,
		MetricName:         name,
		MetricDescription:  desc,
		MetricUnit:         unit,
		Attributes:         AttrMap(attrs),
		StartTimeUnix:      NanoTime(start),
		TimeUnix:           NanoTime(unix),
		Flags:              flags,
	}
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
	case *commonpb.AnyValue_ArrayValue, *commonpb.AnyValue_KvlistValue:
		return marshalJSON(anyValueJSON(v))
	default:
		return ""
	}
}

func marshalJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil || len(b) > maxEncodedAnyValue {
		return ""
	}
	return string(b)
}

func anyValueJSON(v *commonpb.AnyValue) any {
	if v == nil {
		return nil
	}
	switch x := v.Value.(type) {
	case *commonpb.AnyValue_StringValue:
		return x.StringValue
	case *commonpb.AnyValue_BoolValue:
		return x.BoolValue
	case *commonpb.AnyValue_IntValue:
		return x.IntValue
	case *commonpb.AnyValue_DoubleValue:
		return x.DoubleValue
	case *commonpb.AnyValue_BytesValue:
		return hex.EncodeToString(x.BytesValue)
	case *commonpb.AnyValue_ArrayValue:
		values := []*commonpb.AnyValue{}
		if x.ArrayValue != nil {
			values = x.ArrayValue.Values
		}
		out := make([]any, 0, len(values))
		for _, item := range values {
			out = append(out, anyValueJSON(item))
		}
		return out
	case *commonpb.AnyValue_KvlistValue:
		out := map[string]any{}
		if x.KvlistValue == nil {
			return out
		}
		for _, kv := range x.KvlistValue.Values {
			if kv == nil {
				continue
			}
			out[kv.Key] = anyValueJSON(kv.Value)
		}
		return out
	default:
		return nil
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
					if code, ok := statusCodes[span.Status.Code]; ok {
						statusCode = code
					}
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
					SpanKind:           spanKindName(span.Kind),
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

func Metrics(req *metricspb.MetricsData) MetricRows {
	var out MetricRows
	if req == nil {
		return out
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
						row := metricBase(resAttrs, resURL, scopeName, scopeVersion, scopeAttrs, dropped, sm.SchemaUrl, service, metric, pt.Attributes, pt.StartTimeUnixNano, pt.TimeUnixNano, uint32(pt.Flags))
						row.Value = numberValue(pt)
						out.Gauges = append(out.Gauges, row)
					}
				case *metricspb.Metric_Sum:
					if d.Sum == nil {
						continue
					}
					for _, pt := range d.Sum.DataPoints {
						if pt == nil {
							continue
						}
						base := metricBase(resAttrs, resURL, scopeName, scopeVersion, scopeAttrs, dropped, sm.SchemaUrl, service, metric, pt.Attributes, pt.StartTimeUnixNano, pt.TimeUnixNano, uint32(pt.Flags))
						base.Value = numberValue(pt)
						out.Sums = append(out.Sums, SumRow{
							GaugeRow:               base,
							AggregationTemporality: int32(d.Sum.AggregationTemporality),
							IsMonotonic:            d.Sum.IsMonotonic,
						})
					}
				case *metricspb.Metric_Histogram:
					if d.Histogram == nil {
						continue
					}
					for _, pt := range d.Histogram.DataPoints {
						if pt == nil {
							continue
						}
						base := metricBase(resAttrs, resURL, scopeName, scopeVersion, scopeAttrs, dropped, sm.SchemaUrl, service, metric, pt.Attributes, pt.StartTimeUnixNano, pt.TimeUnixNano, uint32(pt.Flags))
						out.Histograms = append(out.Histograms, HistogramRow{
							GaugeRow:               base,
							Count:                  pt.Count,
							Sum:                    pt.GetSum(),
							BucketCounts:           nonemptyUint64(pt.BucketCounts),
							ExplicitBounds:         nonemptyFloat64(pt.ExplicitBounds),
							Min:                    pt.GetMin(),
							Max:                    pt.GetMax(),
							AggregationTemporality: int32(d.Histogram.AggregationTemporality),
						})
					}
				case *metricspb.Metric_Summary:
					if d.Summary == nil {
						continue
					}
					for _, pt := range d.Summary.DataPoints {
						if pt == nil {
							continue
						}
						base := metricBase(resAttrs, resURL, scopeName, scopeVersion, scopeAttrs, dropped, sm.SchemaUrl, service, metric, pt.Attributes, pt.StartTimeUnixNano, pt.TimeUnixNano, uint32(pt.Flags))
						qs := make([]float64, 0, len(pt.QuantileValues))
						vs := make([]float64, 0, len(pt.QuantileValues))
						for _, qv := range pt.QuantileValues {
							if qv == nil {
								continue
							}
							qs = append(qs, qv.Quantile)
							vs = append(vs, qv.Value)
						}
						out.Summaries = append(out.Summaries, SummaryRow{
							GaugeRow:  base,
							Count:     pt.Count,
							Sum:       pt.Sum,
							Quantiles: qs,
							Values:    vs,
						})
					}
				case *metricspb.Metric_ExponentialHistogram:
					if d.ExponentialHistogram == nil {
						continue
					}
					for _, pt := range d.ExponentialHistogram.DataPoints {
						if pt == nil {
							continue
						}
						base := metricBase(resAttrs, resURL, scopeName, scopeVersion, scopeAttrs, dropped, sm.SchemaUrl, service, metric, pt.Attributes, pt.StartTimeUnixNano, pt.TimeUnixNano, uint32(pt.Flags))
						posOff, posCounts := int32(0), []uint64{}
						negOff, negCounts := int32(0), []uint64{}
						if pt.Positive != nil {
							posOff = pt.Positive.Offset
							posCounts = nonemptyUint64(pt.Positive.BucketCounts)
						}
						if pt.Negative != nil {
							negOff = pt.Negative.Offset
							negCounts = nonemptyUint64(pt.Negative.BucketCounts)
						}
						out.ExpHistograms = append(out.ExpHistograms, ExpHistogramRow{
							GaugeRow:               base,
							Count:                  pt.Count,
							Sum:                    pt.GetSum(),
							Scale:                  pt.Scale,
							ZeroCount:              pt.ZeroCount,
							PositiveOffset:         posOff,
							PositiveBucketCounts:   posCounts,
							NegativeOffset:         negOff,
							NegativeBucketCounts:   negCounts,
							Min:                    pt.GetMin(),
							Max:                    pt.GetMax(),
							AggregationTemporality: int32(d.ExponentialHistogram.AggregationTemporality),
						})
					}
				}
			}
		}
	}
	return out
}

func nonemptyUint64(in []uint64) []uint64 {
	if in == nil {
		return []uint64{}
	}
	return in
}

func nonemptyFloat64(in []float64) []float64 {
	if in == nil {
		return []float64{}
	}
	return in
}

type ResourceTenant struct {
	OrganisationID string
	ProjectID      string
	Environment    string
}

func StampResource(attrs map[string]string, tenant ResourceTenant) map[string]string {
	out := make(map[string]string, len(attrs))
	for k, v := range attrs {
		out[k] = v
	}
	if tenant.Environment != "" {
		out["organisation.environment.name"] = tenant.Environment
	}
	if tenant.OrganisationID != "" {
		out["openlit.organisation.id"] = tenant.OrganisationID
	}
	if tenant.ProjectID != "" {
		out["openlit.project.id"] = tenant.ProjectID
	}
	return out
}

func StampTraces(rows []TraceRow, tenant ResourceTenant) {
	for i := range rows {
		rows[i].ResourceAttributes = StampResource(rows[i].ResourceAttributes, tenant)
	}
}

func StampLogs(rows []LogRow, tenant ResourceTenant) {
	for i := range rows {
		rows[i].ResourceAttributes = StampResource(rows[i].ResourceAttributes, tenant)
	}
}

func StampGauges(rows []GaugeRow, tenant ResourceTenant) {
	for i := range rows {
		rows[i].ResourceAttributes = StampResource(rows[i].ResourceAttributes, tenant)
	}
}

func StampSums(rows []SumRow, tenant ResourceTenant) {
	for i := range rows {
		rows[i].ResourceAttributes = StampResource(rows[i].ResourceAttributes, tenant)
	}
}

func StampHistograms(rows []HistogramRow, tenant ResourceTenant) {
	for i := range rows {
		rows[i].ResourceAttributes = StampResource(rows[i].ResourceAttributes, tenant)
	}
}

func StampSummaries(rows []SummaryRow, tenant ResourceTenant) {
	for i := range rows {
		rows[i].ResourceAttributes = StampResource(rows[i].ResourceAttributes, tenant)
	}
}

func StampExpHistograms(rows []ExpHistogramRow, tenant ResourceTenant) {
	for i := range rows {
		rows[i].ResourceAttributes = StampResource(rows[i].ResourceAttributes, tenant)
	}
}

func StampMetrics(rows *MetricRows, tenant ResourceTenant) {
	if rows == nil {
		return
	}
	StampGauges(rows.Gauges, tenant)
	StampSums(rows.Sums, tenant)
	StampHistograms(rows.Histograms, tenant)
	StampSummaries(rows.Summaries, tenant)
	StampExpHistograms(rows.ExpHistograms, tenant)
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
