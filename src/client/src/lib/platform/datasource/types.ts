/**
 * Pluggable telemetry source contract (CE).
 *
 * Every raw-telemetry read (traces, logs, metrics) in OpenLIT flows through a
 * `DataSourceAdapter`. ClickHouse is the reference/default implementation and
 * lives in CE; external vendor adapters (Datadog, Grafana/Tempo/Loki/Mimir,
 * New Relic, Jaeger, Victoria stack) live in the private enterprise repo under
 * `src/client/src/ee/**` and are registered via the neutral extension hook in
 * `./enterprise`.
 *
 * Derived/app data (evals, agent summaries, dashboards metadata, controller,
 * vault, rules, prompts) is NOT part of this contract — it always stays in
 * OpenLIT's own ClickHouse app store.
 */

/** The three telemetry signals OpenLIT reads. */
export type Signal = "traces" | "logs" | "metrics";

/** A normalized time range. `start`/`end` are absolute instants. */
export interface QueryTimeRange {
	start: Date;
	end: Date;
}

/**
 * A normalized span, vendor-agnostic. Attribute maps use OTel semantic
 * convention keys (e.g. `gen_ai.operation.name`) exactly as the product's
 * `TraceMapping` expects, so surfaces never assume ClickHouse `Map` columns.
 */
export interface NormalizedSpan {
	traceId: string;
	spanId: string;
	parentSpanId: string;
	name: string;
	serviceName: string;
	/** ISO-8601 timestamp string. */
	timestamp: string;
	/** Span duration in nanoseconds (OTel canonical unit). */
	durationNs: number;
	statusCode: string;
	statusMessage?: string;
	spanKind?: string;
	spanAttributes: Record<string, string>;
	resourceAttributes: Record<string, string>;
	events?: NormalizedSpanEvent[];
	/** Optional pre-resolved cost (USD) applied by cost overlay / vendor. */
	cost?: number;
}

export interface NormalizedSpanEvent {
	name: string;
	/** ISO-8601 timestamp string. */
	timestamp?: string;
	attributes: Record<string, string>;
}

/** A normalized log record. */
export interface NormalizedLog {
	timestamp: string;
	traceId?: string;
	spanId?: string;
	severityText?: string;
	severityNumber?: number;
	body: string;
	serviceName?: string;
	logAttributes: Record<string, string>;
	resourceAttributes: Record<string, string>;
	scopeAttributes?: Record<string, string>;
}

/** A single metric data point. */
export interface NormalizedMetricPoint {
	metricName: string;
	description?: string;
	unit?: string;
	serviceName?: string;
	/** ISO-8601 timestamp string. */
	timestamp: string;
	value: number;
	attributes: Record<string, string>;
	resourceAttributes: Record<string, string>;
}

/** Attribute scope for a filter/selector condition. */
export type AttributeScope = "span" | "resource" | "log" | "metric";

/** Comparison operators supported by normalized filters. */
export type FilterOp =
	| "exists"
	| "notExists"
	| "eq"
	| "neq"
	| "in"
	| "notIn"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "contains";

/**
 * A normalized attribute predicate. `target: "spanName"` matches on the span
 * name (or metric name for the metrics signal) rather than an attribute map.
 */
export interface NormalizedFilter {
	target: "attribute" | "spanName" | "status" | "duration";
	scope?: AttributeScope;
	key?: string;
	op: FilterOp;
	value?: string | string[] | number;
}

/** Aggregation functions the query layer can request. */
export type AggregationFn =
	| "count"
	| "sum"
	| "avg"
	| "min"
	| "max"
	| "p50"
	| "p90"
	| "p95"
	| "p99"
	| "cardinality";

export interface Aggregation {
	fn: AggregationFn;
	/** Attribute/field to aggregate; omit for count. */
	field?: string;
	/** Result column alias. */
	as?: string;
}

export interface QuerySort {
	field: string;
	direction: "asc" | "desc";
}

/**
 * A vendor-agnostic query. Adapters translate this into their native query
 * language (ClickHouse SQL, TraceQL, PromQL, NRQL, Datadog query, etc.).
 */
export interface OpenLITQuery {
	signal: Signal;
	timeRange: QueryTimeRange;
	filters?: NormalizedFilter[];
	groupBy?: string[];
	aggregations?: Aggregation[];
	sort?: QuerySort[];
	limit?: number;
	offset?: number;
	/**
	 * When true, the adapter MUST push the AI-only selector down to the vendor
	 * so only AI-relevant telemetry is returned. Defaults to true for the
	 * intelligence surfaces.
	 */
	aiSelector?: boolean;
	/**
	 * Optional time-bucket size for time-series requests, e.g. "1m", "1h".
	 * Adapters map this to their native bucketing.
	 */
	interval?: string;
}

/** A normalized columnar result. */
export interface DataFrame<TRow = unknown> {
	fields: DataFrameField[];
	rows: TRow[];
	meta?: DataFrameMeta;
}

export interface DataFrameField {
	name: string;
	type: "string" | "number" | "boolean" | "time" | "map" | "json";
}

export interface DataFrameMeta {
	/** True when the vendor truncated results (hit a row/scan cap). */
	truncated?: boolean;
	/** Estimated vendor query cost/credits where the vendor reports it. */
	vendorCost?: number;
	/** Capabilities that were degraded/emulated for this query. */
	degraded?: string[];
	/** Adapter query latency in ms (for query observability). */
	latencyMs?: number;
	/** Number of rows scanned/returned by the vendor where reported. */
	rowsScanned?: number;
}

/**
 * Declares what a source can and cannot do. Surfaces read this to render
 * first-class "not supported by this data source" states instead of failing.
 */
export interface SourceCapabilities {
	/** Which signals this source can serve. */
	signals: Signal[];
	/** Can reconstruct a full parent/child trace tree. */
	traceTree: boolean;
	/** Exposes OTel span events (prompt/completion payloads). */
	spanEvents: boolean;
	/** Supports server-side aggregation (group by + aggregate fns). */
	serverAggregation: boolean;
	/** Supports mutating stored spans (e.g. in-place cost backfill). */
	spanMutation: boolean;
	/** Can enumerate distinct attribute values / attribute keys. */
	distinctValues: boolean;
	/** Can stitch coding-agent sessions across multiple trace ids. */
	crossTraceSession: boolean;
	/** Max lookback window in milliseconds, if the vendor caps it. */
	maxLookbackMs?: number;
	/** Whether raw vendor-native query strings are supported (CH only). */
	rawQuery: boolean;
}

/**
 * Correlation keys a source type can expose so cross-signal joins (traces to
 * logs, agent snapshots to tool-definition logs, etc.) are possible with data
 * living in a *different* source. Grafana calls this "trace-to-logs"/derived
 * fields; OpenLIT declares it up front so surfaces degrade honestly.
 */
export type CorrelationKey = "traceId" | "spanId" | "service" | "session";

/** How a source type participates in cross-signal correlation. */
export interface SourceCorrelation {
	/**
	 * True when the source exposes at least one correlation key that lets its
	 * data be joined with another signal living in a different source. Built-in
	 * ClickHouse is fully correlatable; metrics-only backends usually are not.
	 */
	crossSignal: boolean;
	/** The correlation keys this source type reliably carries. */
	keys: CorrelationKey[];
}

/**
 * Static, type-level description of a source type (Grafana-style plugin
 * descriptor). Unlike `SourceCapabilities`, which is resolved per configured
 * instance, this is the maximal profile the *type* supports and is used to
 * populate source pickers, validate configured signals, and reason about
 * correlation before any instance exists.
 */
export interface SourceTypeDescriptor {
	/** Source type key, e.g. "clickhouse", "tempo". */
	type: string;
	/** Human-readable name for source pickers. */
	displayName: string;
	/** Maximal set of signals a source of this type can serve. */
	declaredSignals: Signal[];
	/** Maximal capability profile for the type (signals declared separately). */
	capabilities: Omit<SourceCapabilities, "signals">;
	/** Cross-signal correlation profile for the type. */
	correlation: SourceCorrelation;
	/**
	 * Internal-only types (multi-signal "stack" umbrellas such as grafana /
	 * victoria) are not offered as atomic rows in the source picker; they exist
	 * only as convenience templates that expand into atomic per-signal rows.
	 */
	internal?: boolean;
}

/** Result of a health check against a configured source. */
export interface HealthCheckResult {
	ok: boolean;
	message?: string;
	latencyMs?: number;
}

/** Result of validating that a source actually carries AI telemetry. */
export interface AISignalValidation {
	ok: boolean;
	/** Sampled span count matching the AI selector in the probe window. */
	sampleCount: number;
	/** Missing-but-recommended attributes found absent during the probe. */
	missingAttributes: string[];
	message?: string;
}

/** A discovered service/workload row used by agent materialization. */
export interface DiscoveredService {
	serviceName: string;
	environment: string;
	clusterId: string;
	workloadKey?: string;
	sdkName?: string;
	sdkLanguage?: string;
	sdkVersion?: string;
	firstSeen?: string;
	lastSeen?: string;
}

/** A per-service rollup used by agent materialization. */
export interface ServiceRollup {
	serviceName: string;
	environment: string;
	clusterId: string;
	requestCount: number;
	models: string[];
	providers: string[];
}

/**
 * The complete adapter contract. Method groups mirror the product surfaces.
 * Adapters implement every method their `capabilities()` advertises; methods
 * for unsupported capabilities should throw `UnsupportedCapabilityError`.
 */
export interface DataSourceAdapter {
	readonly type: string;
	capabilities(): SourceCapabilities;
	healthCheck(): Promise<HealthCheckResult>;
	validateAISignal(window: QueryTimeRange): Promise<AISignalValidation>;

	// Traces
	listSpans(query: OpenLITQuery): Promise<DataFrame<NormalizedSpan>>;
	getSpan(spanId: string): Promise<NormalizedSpan | null>;
	getTraceSpans(traceId: string): Promise<NormalizedSpan[]>;
	getSpansBySession(sessionId: string): Promise<NormalizedSpan[]>;
	aggregateSpans(query: OpenLITQuery): Promise<DataFrame>;
	spanTimeSeries(query: OpenLITQuery): Promise<DataFrame>;
	distinctValues(key: string, query: OpenLITQuery): Promise<string[]>;
	attributeKeys(signal: Signal, window: QueryTimeRange): Promise<string[]>;

	// Logs
	listLogs(query: OpenLITQuery): Promise<DataFrame<NormalizedLog>>;
	getLog(logId: string): Promise<NormalizedLog | null>;
	logTimeSeries(query: OpenLITQuery): Promise<DataFrame>;

	// Metrics
	listMetricSeries(query: OpenLITQuery): Promise<DataFrame<NormalizedMetricPoint>>;
	metricTimeSeries(query: OpenLITQuery): Promise<DataFrame<NormalizedMetricPoint>>;
	metricNames(window: QueryTimeRange): Promise<string[]>;

	// Discovery (agents / clusters)
	discoverServices(window: QueryTimeRange): Promise<DiscoveredService[]>;
	aggregateByService(window: QueryTimeRange): Promise<ServiceRollup[]>;
	sampleTracesForGraph(
		query: OpenLITQuery,
		maxTraces: number
	): Promise<NormalizedSpan[]>;
}

/** Descriptor of a resolved telemetry source (before adapter binding). */
export interface TelemetrySourceDescriptor {
	/** Source type, e.g. "clickhouse", "datadog", "tempo". */
	type: string;
	/** Stable id: built-in sources use `builtin:<dbConfigId>`. */
	id: string;
	/** Whether this is the implicit built-in ClickHouse source. */
	isBuiltIn: boolean;
	/** Non-secret settings (URLs, site, orgId, etc.). */
	settings: Record<string, unknown>;
	/** Vault secret id holding credentials, if any. */
	secretRef?: string | null;
	/** For built-in ClickHouse: the backing DatabaseConfig id. */
	dbConfigId?: string;
	/** Signals this source is configured to serve. */
	signals: Signal[];
	/** Project this source belongs to (null for orphaned/built-in). */
	projectId?: string | null;
	/** Human-readable name. */
	name: string;
}

/**
 * Factory that binds a resolved descriptor to a concrete adapter instance.
 * CE registers the ClickHouse factory; EE registers vendor factories via the
 * neutral `getExternalDataSourceAdapters()` hook.
 */
export interface DataSourceAdapterFactory {
	type: string;
	create(descriptor: TelemetrySourceDescriptor): DataSourceAdapter;
	/** Static, type-level descriptor used before any instance is bound. */
	describe(): SourceTypeDescriptor;
}

/** Thrown by adapters when a surface requests an unsupported capability. */
export class UnsupportedCapabilityError extends Error {
	readonly capability: string;
	readonly sourceType: string;
	constructor(sourceType: string, capability: string, message?: string) {
		super(
			message ||
				`Capability "${capability}" is not supported by data source "${sourceType}".`
		);
		this.name = "UnsupportedCapabilityError";
		this.capability = capability;
		this.sourceType = sourceType;
	}
}
