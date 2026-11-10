package chschema

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

const TTLHours = 730

var ensured sync.Map

func Ensure(ctx context.Context, conn driver.Conn, fingerprint string) error {
	if fingerprint != "" {
		if _, ok := ensured.Load(fingerprint); ok {
			return nil
		}
	}
	err := createAll(ctx, conn)
	if err != nil {
		if isPrivilegeError(err) {
			ok, existsErr := tablesExist(ctx, conn)
			if existsErr != nil {
				return fmt.Errorf("schema bootstrap denied and existence check failed: %w", existsErr)
			}
			if !ok {
				return fmt.Errorf("clickhouse user cannot CREATE TABLE and otel_* tables are missing")
			}
			if fingerprint != "" {
				ensured.Store(fingerprint, struct{}{})
			}
			return nil
		}
		return err
	}
	if fingerprint != "" {
		ensured.Store(fingerprint, struct{}{})
	}
	return nil
}

func Forget(fingerprint string) {
	if fingerprint != "" {
		ensured.Delete(fingerprint)
	}
}

func IsMissingTable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToUpper(err.Error())
	return strings.Contains(msg, "UNKNOWN_TABLE") ||
		strings.Contains(msg, "UNKNOWN TABLE") ||
		strings.Contains(msg, "DOESN'T EXIST") ||
		strings.Contains(msg, "DOES NOT EXIST")
}

func RequiredTables() []string {
	return []string{
		"otel_traces",
		"otel_logs",
		"otel_metrics_gauge",
		"otel_metrics_sum",
		"otel_metrics_histogram",
		"otel_metrics_summary",
		"otel_metrics_exponential_histogram",
		"otel_traces_trace_id_ts",
	}
}

func createAll(ctx context.Context, conn driver.Conn) error {
	for _, stmt := range Statements() {
		if err := conn.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	return nil
}

func tablesExist(ctx context.Context, conn driver.Conn) (bool, error) {
	for _, table := range RequiredTables() {
		var exists uint8
		if err := conn.QueryRow(ctx, "EXISTS TABLE "+table).Scan(&exists); err != nil {
			return false, err
		}
		if exists != 1 {
			return false, nil
		}
	}
	return true, nil
}

func isPrivilegeError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToUpper(err.Error())
	return strings.Contains(msg, "ACCESS_DENIED") ||
		strings.Contains(msg, "NOT_ENOUGH_PRIVILEGES") ||
		strings.Contains(msg, "NOT ENOUGH PRIVILEGES")
}

func Statements() []string {
	ttl := TTLHours
	return []string{
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS otel_traces
(
    Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    ParentSpanId String CODEC(ZSTD(1)),
    TraceState String CODEC(ZSTD(1)),
    SpanName LowCardinality(String) CODEC(ZSTD(1)),
    SpanKind LowCardinality(String) CODEC(ZSTD(1)),
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    Duration UInt64 CODEC(ZSTD(1)),
    StatusCode LowCardinality(String) CODEC(ZSTD(1)),
    StatusMessage String CODEC(ZSTD(1)),
    `+"`Events.Timestamp`"+` Array(DateTime64(9)) CODEC(ZSTD(1)),
    `+"`Events.Name`"+` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `+"`Events.Attributes`"+` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    `+"`Links.TraceId`"+` Array(String) CODEC(ZSTD(1)),
    `+"`Links.SpanId`"+` Array(String) CODEC(ZSTD(1)),
    `+"`Links.TraceState`"+` Array(String) CODEC(ZSTD(1)),
    `+"`Links.Attributes`"+` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))
TTL toDateTime(Timestamp) + toIntervalHour(%d)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1`, ttl),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS otel_logs
(
    Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    TimestampTime DateTime DEFAULT toDateTime(Timestamp),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    TraceFlags UInt8,
    SeverityText LowCardinality(String) CODEC(ZSTD(1)),
    SeverityNumber UInt8,
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    Body String CODEC(ZSTD(1)),
    ResourceSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion LowCardinality(String) CODEC(ZSTD(1)),
    ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_log_attr_key mapKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY toDate(TimestampTime)
PRIMARY KEY (ServiceName, TimestampTime)
ORDER BY (ServiceName, TimestampTime, Timestamp)
TTL TimestampTime + toIntervalHour(%d)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1`, ttl),
		metricTable("otel_metrics_gauge", `
    Value Float64 CODEC(ZSTD(1)),
    Flags UInt32 CODEC(ZSTD(1))`, ttl),
		metricTable("otel_metrics_sum", `
    Value Float64 CODEC(ZSTD(1)),
    Flags UInt32 CODEC(ZSTD(1)),
    AggregationTemporality Int32 CODEC(ZSTD(1)),
    IsMonotonic Bool CODEC(Delta(1), ZSTD(1))`, ttl),
		metricTable("otel_metrics_histogram", `
    Count UInt64 CODEC(Delta(8), ZSTD(1)),
    Sum Float64 CODEC(ZSTD(1)),
    BucketCounts Array(UInt64) CODEC(ZSTD(1)),
    ExplicitBounds Array(Float64) CODEC(ZSTD(1)),
    Flags UInt32 CODEC(ZSTD(1)),
    Min Float64 CODEC(ZSTD(1)),
    Max Float64 CODEC(ZSTD(1)),
    AggregationTemporality Int32 CODEC(ZSTD(1))`, ttl),
		metricTable("otel_metrics_summary", `
    Count UInt64 CODEC(Delta(8), ZSTD(1)),
    Sum Float64 CODEC(ZSTD(1)),
    `+"`ValueAtQuantiles.Quantile`"+` Array(Float64) CODEC(ZSTD(1)),
    `+"`ValueAtQuantiles.Value`"+` Array(Float64) CODEC(ZSTD(1)),
    Flags UInt32 CODEC(ZSTD(1))`, ttl),
		metricTable("otel_metrics_exponential_histogram", `
    Count UInt64 CODEC(Delta(8), ZSTD(1)),
    Sum Float64 CODEC(ZSTD(1)),
    Scale Int32 CODEC(ZSTD(1)),
    ZeroCount UInt64 CODEC(ZSTD(1)),
    PositiveOffset Int32 CODEC(ZSTD(1)),
    PositiveBucketCounts Array(UInt64) CODEC(ZSTD(1)),
    NegativeOffset Int32 CODEC(ZSTD(1)),
    NegativeBucketCounts Array(UInt64) CODEC(ZSTD(1)),
    Flags UInt32 CODEC(ZSTD(1)),
    Min Float64 CODEC(ZSTD(1)),
    Max Float64 CODEC(ZSTD(1)),
    AggregationTemporality Int32 CODEC(ZSTD(1))`, ttl),
		fmt.Sprintf(`CREATE TABLE IF NOT EXISTS otel_traces_trace_id_ts
(
    TraceId String CODEC(ZSTD(1)),
    Start DateTime CODEC(Delta(4), ZSTD(1)),
    End DateTime CODEC(Delta(4), ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Start)
ORDER BY (TraceId, Start)
TTL toDateTime(Start) + toIntervalHour(%d)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1`, ttl),
		`CREATE MATERIALIZED VIEW IF NOT EXISTS otel_traces_trace_id_ts_mv TO otel_traces_trace_id_ts
AS SELECT
    TraceId,
    min(Timestamp) AS Start,
    max(Timestamp) AS End
FROM otel_traces
WHERE TraceId != ''
GROUP BY TraceId`,
	}
}

func metricTable(name, extra string, ttl int) string {
	return fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s
(
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ResourceSchemaUrl String CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion String CODEC(ZSTD(1)),
    ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeDroppedAttrCount UInt32 CODEC(ZSTD(1)),
    ScopeSchemaUrl String CODEC(ZSTD(1)),
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    MetricName String CODEC(ZSTD(1)),
    MetricDescription String CODEC(ZSTD(1)),
    MetricUnit String CODEC(ZSTD(1)),
    Attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    StartTimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    TimeUnix DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    %s
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDateTime(TimeUnix) + toIntervalHour(%d)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1`, name, strings.TrimSpace(extra), ttl)
}
