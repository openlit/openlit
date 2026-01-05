#!/bin/bash
set -e

# Get database name from environment or use default
DATABASE_NAME="${CLICKHOUSE_DATABASE:-openlit}"

echo "==================== ClickHouse Initialization ===================="
echo "Creating database: $DATABASE_NAME"

# Create the database if it doesn't exist
clickhouse-client --query "CREATE DATABASE IF NOT EXISTS $DATABASE_NAME"

echo "✅ Database $DATABASE_NAME created successfully"
echo ""
echo "Creating OTEL tables required by OpenTelemetry Collector..."

# Create OTEL tables in the database
# These tables must exist before the OTEL collector starts writing data

# OTEL Traces Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE TABLE IF NOT EXISTS otel_traces (
	Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
	TraceId String CODEC(ZSTD(1)),
	SpanId String CODEC(ZSTD(1)),
	ParentSpanId String CODEC(ZSTD(1)),
	TraceState String CODEC(ZSTD(1)),
	SpanName LowCardinality(String) CODEC(ZSTD(1)),
	SpanKind LowCardinality(String) CODEC(ZSTD(1)),
	ServiceName LowCardinality(String) CODEC(ZSTD(1)),
	ResourceSchemaUrl String CODEC(ZSTD(1)),
	ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
	ScopeName String CODEC(ZSTD(1)),
	ScopeVersion String CODEC(ZSTD(1)),
	ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
	ScopeDroppedAttrCount UInt32 CODEC(ZSTD(1)),
	ScopeSchemaUrl String CODEC(ZSTD(1)),
	SpanAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
	Duration Int64 CODEC(ZSTD(1)),
	StatusCode LowCardinality(String) CODEC(ZSTD(1)),
	StatusMessage String CODEC(ZSTD(1)),
	\`Events.Timestamp\` Array(DateTime64(9)) CODEC(ZSTD(1)),
	\`Events.Name\` Array(LowCardinality(String)) CODEC(ZSTD(1)),
	\`Events.Attributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
	\`Links.TraceId\` Array(String) CODEC(ZSTD(1)),
	\`Links.SpanId\` Array(String) CODEC(ZSTD(1)),
	\`Links.TraceState\` Array(String) CODEC(ZSTD(1)),
	\`Links.Attributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
	INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
	INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_duration Duration TYPE minmax GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toUnixTimestamp(Timestamp), TraceId)
TTL toDateTime(Timestamp) + INTERVAL 730 HOUR
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
"

# OTEL Logs Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE TABLE IF NOT EXISTS otel_logs (
	Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
	TraceId String CODEC(ZSTD(1)),
	SpanId String CODEC(ZSTD(1)),
	TraceFlags UInt32 CODEC(ZSTD(1)),
	SeverityText LowCardinality(String) CODEC(ZSTD(1)),
	SeverityNumber Int32 CODEC(ZSTD(1)),
	ServiceName LowCardinality(String) CODEC(ZSTD(1)),
	Body String CODEC(ZSTD(1)),
	ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
	LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
	INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
	INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_log_attr_key mapKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SeverityText, toUnixTimestamp(Timestamp), TraceId)
TTL toDateTime(Timestamp) + INTERVAL 730 HOUR
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
"

# OTEL Metrics Gauge Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE TABLE IF NOT EXISTS otel_metrics_gauge (
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
	Value Float64 CODEC(ZSTD(1)),
	Flags UInt32 CODEC(ZSTD(1)),
	\`Exemplars.FilteredAttributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
	\`Exemplars.TimeUnix\` Array(DateTime64(9)) CODEC(ZSTD(1)),
	\`Exemplars.Value\` Array(Float64) CODEC(ZSTD(1)),
	\`Exemplars.SpanId\` Array(String) CODEC(ZSTD(1)),
	\`Exemplars.TraceId\` Array(String) CODEC(ZSTD(1)),
	INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp(TimeUnix))
TTL toDateTime(TimeUnix) + INTERVAL 730 HOUR
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
"

# OTEL Metrics Sum Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE TABLE IF NOT EXISTS otel_metrics_sum (
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
	Value Float64 CODEC(ZSTD(1)),
	Flags UInt32 CODEC(ZSTD(1)),
	\`Exemplars.FilteredAttributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
	\`Exemplars.TimeUnix\` Array(DateTime64(9)) CODEC(ZSTD(1)),
	\`Exemplars.Value\` Array(Float64) CODEC(ZSTD(1)),
	\`Exemplars.SpanId\` Array(String) CODEC(ZSTD(1)),
	\`Exemplars.TraceId\` Array(String) CODEC(ZSTD(1)),
	AggregationTemporality Int32 CODEC(ZSTD(1)),
	IsMonotonic Bool CODEC(Delta(1), ZSTD(1)),
	INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp(TimeUnix))
TTL toDateTime(TimeUnix) + INTERVAL 730 HOUR
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
"

# OTEL Metrics Histogram Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE TABLE IF NOT EXISTS otel_metrics_histogram (
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
	Count UInt64 CODEC(Delta(8), ZSTD(1)),
	Sum Float64 CODEC(ZSTD(1)),
	BucketCounts Array(UInt64) CODEC(ZSTD(1)),
	ExplicitBounds Array(Float64) CODEC(ZSTD(1)),
	\`Exemplars.FilteredAttributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
	\`Exemplars.TimeUnix\` Array(DateTime64(9)) CODEC(ZSTD(1)),
	\`Exemplars.Value\` Array(Float64) CODEC(ZSTD(1)),
	\`Exemplars.SpanId\` Array(String) CODEC(ZSTD(1)),
	\`Exemplars.TraceId\` Array(String) CODEC(ZSTD(1)),
	Flags UInt32 CODEC(ZSTD(1)),
	Min Float64 CODEC(ZSTD(1)),
	Max Float64 CODEC(ZSTD(1)),
	AggregationTemporality Int32 CODEC(ZSTD(1)),
	INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp(TimeUnix))
TTL toDateTime(TimeUnix) + INTERVAL 730 HOUR
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
"

# OTEL Metrics Summary Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE TABLE IF NOT EXISTS otel_metrics_summary (
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
	Count UInt64 CODEC(Delta(8), ZSTD(1)),
	Sum Float64 CODEC(ZSTD(1)),
	\`ValueAtQuantiles.Quantile\` Array(Float64) CODEC(ZSTD(1)),
	\`ValueAtQuantiles.Value\` Array(Float64) CODEC(ZSTD(1)),
	Flags UInt32 CODEC(ZSTD(1)),
	INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp(TimeUnix))
TTL toDateTime(TimeUnix) + INTERVAL 730 HOUR
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
"

# OTEL Metrics Exponential Histogram Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE TABLE IF NOT EXISTS otel_metrics_exponential_histogram (
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
	Count UInt64 CODEC(Delta(8), ZSTD(1)),
	Sum Float64 CODEC(ZSTD(1)),
	Scale Int32 CODEC(ZSTD(1)),
	ZeroCount UInt64 CODEC(ZSTD(1)),
	PositiveOffset Int32 CODEC(ZSTD(1)),
	PositiveBucketCounts Array(UInt64) CODEC(ZSTD(1)),
	NegativeOffset Int32 CODEC(ZSTD(1)),
	NegativeBucketCounts Array(UInt64) CODEC(ZSTD(1)),
	\`Exemplars.FilteredAttributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
	\`Exemplars.TimeUnix\` Array(DateTime64(9)) CODEC(ZSTD(1)),
	\`Exemplars.Value\` Array(Float64) CODEC(ZSTD(1)),
	\`Exemplars.SpanId\` Array(String) CODEC(ZSTD(1)),
	\`Exemplars.TraceId\` Array(String) CODEC(ZSTD(1)),
	Flags UInt32 CODEC(ZSTD(1)),
	Min Float64 CODEC(ZSTD(1)),
	Max Float64 CODEC(ZSTD(1)),
	AggregationTemporality Int32 CODEC(ZSTD(1)),
	INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
	INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp(TimeUnix))
TTL toDateTime(TimeUnix) + INTERVAL 730 HOUR
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
"

# OTEL Traces TraceID Timestamp Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE TABLE IF NOT EXISTS otel_traces_trace_id_ts (
	TraceId String CODEC(ZSTD(1)),
	Start DateTime CODEC(Delta(4), ZSTD(1)),
	End DateTime CODEC(Delta(4), ZSTD(1)),
	INDEX idx_trace_id TraceId TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree
PARTITION BY toDate(Start)
ORDER BY (TraceId, Start)
TTL toDateTime(Start) + INTERVAL 730 HOUR
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
"

# Materialized View for Trace Timestamp Table
clickhouse-client --database="$DATABASE_NAME" --query "
CREATE MATERIALIZED VIEW IF NOT EXISTS otel_traces_trace_id_ts_mv
TO otel_traces_trace_id_ts
AS SELECT
	TraceId,
	toDateTime(min(Timestamp)) AS Start,
	toDateTime(max(Timestamp)) AS End
FROM otel_traces
WHERE TraceId != ''
GROUP BY TraceId
"

echo "✅ All 9 OTEL tables created successfully"
echo "===================================================================="
