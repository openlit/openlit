/**
 * Base class for external DataSourceAdapters.
 *
 * Every method defaults to throwing `UnsupportedCapabilityError`, so a vendor
 * adapter only implements what its backend actually supports and any surface
 * that reaches an unsupported capability gets a first-class, explained error
 * (never a silent wrong result). `capabilities()` is the single source of
 * truth the UI reads to gate features.
 */

import {
	UnsupportedCapabilityError,
	type AISignalValidation,
	type DataFrame,
	type DataSourceAdapter,
	type DiscoveredService,
	type HealthCheckResult,
	type NormalizedLog,
	type NormalizedMetricPoint,
	type NormalizedSpan,
	type OpenLITQuery,
	type QueryTimeRange,
	type ServiceRollup,
	type Signal,
	type SourceCapabilities,
	type TelemetrySourceDescriptor,
} from "./types";

export abstract class BaseExternalAdapter implements DataSourceAdapter {
	abstract readonly type: string;
	protected readonly descriptor: TelemetrySourceDescriptor;

	constructor(descriptor: TelemetrySourceDescriptor) {
		this.descriptor = descriptor;
	}

	abstract capabilities(): SourceCapabilities;
	abstract healthCheck(): Promise<HealthCheckResult>;

	protected unsupported(capability: string): never {
		throw new UnsupportedCapabilityError(this.type, capability);
	}

	async validateAISignal(_window: QueryTimeRange): Promise<AISignalValidation> {
		this.unsupported("validateAISignal");
	}

	// Traces
	async listSpans(_q: OpenLITQuery): Promise<DataFrame<NormalizedSpan>> {
		this.unsupported("listSpans");
	}
	async getSpan(_spanId: string): Promise<NormalizedSpan | null> {
		this.unsupported("getSpan");
	}
	async getTraceSpans(_traceId: string): Promise<NormalizedSpan[]> {
		this.unsupported("getTraceSpans");
	}
	async getSpansBySession(_sessionId: string): Promise<NormalizedSpan[]> {
		this.unsupported("getSpansBySession");
	}
	async aggregateSpans(_q: OpenLITQuery): Promise<DataFrame> {
		this.unsupported("aggregateSpans");
	}
	async spanTimeSeries(_q: OpenLITQuery): Promise<DataFrame> {
		this.unsupported("spanTimeSeries");
	}
	async distinctValues(_key: string, _q: OpenLITQuery): Promise<string[]> {
		this.unsupported("distinctValues");
	}
	async attributeKeys(_signal: Signal, _w: QueryTimeRange): Promise<string[]> {
		this.unsupported("attributeKeys");
	}

	// Logs
	async listLogs(_q: OpenLITQuery): Promise<DataFrame<NormalizedLog>> {
		this.unsupported("listLogs");
	}
	async getLog(_logId: string): Promise<NormalizedLog | null> {
		this.unsupported("getLog");
	}
	async logTimeSeries(_q: OpenLITQuery): Promise<DataFrame> {
		this.unsupported("logTimeSeries");
	}

	// Metrics
	async listMetricSeries(
		_q: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		this.unsupported("listMetricSeries");
	}
	async metricTimeSeries(
		_q: OpenLITQuery
	): Promise<DataFrame<NormalizedMetricPoint>> {
		this.unsupported("metricTimeSeries");
	}
	async metricNames(_w: QueryTimeRange): Promise<string[]> {
		this.unsupported("metricNames");
	}

	// Discovery
	async discoverServices(_w: QueryTimeRange): Promise<DiscoveredService[]> {
		this.unsupported("discoverServices");
	}
	async aggregateByService(_w: QueryTimeRange): Promise<ServiceRollup[]> {
		this.unsupported("aggregateByService");
	}
	async sampleTracesForGraph(
		_q: OpenLITQuery,
		_maxTraces: number
	): Promise<NormalizedSpan[]> {
		this.unsupported("sampleTracesForGraph");
	}
}
