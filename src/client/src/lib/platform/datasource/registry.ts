/**
 * Telemetry data source adapter registry (CE).
 *
 * Holds adapter factories keyed by source type. CE always registers the
 * ClickHouse factory (the reference/default). External vendor factories are
 * contributed by the enterprise repo through the neutral
 * `getExternalDataSourceAdapters()` hook, so no `@/ee/**` import ever appears
 * in CE.
 */

import type {
	DataSourceAdapter,
	DataSourceAdapterFactory,
	SourceTypeDescriptor,
	TelemetrySourceDescriptor,
} from "./types";
import { getExternalDataSourceAdapters } from "./enterprise";

const factories = new Map<string, DataSourceAdapterFactory>();
let externalLoaded = false;

/** Register (or replace) an adapter factory. */
export function registerAdapterFactory(factory: DataSourceAdapterFactory): void {
	factories.set(factory.type, factory);
}

/** Load enterprise-provided factories exactly once. */
function ensureExternalLoaded(): void {
	if (externalLoaded) return;
	externalLoaded = true;
	for (const factory of getExternalDataSourceAdapters()) {
		// CE-registered factories (e.g. clickhouse) take precedence only if the
		// enterprise repo has not explicitly overridden them; here external
		// factories register their own distinct types.
		if (!factories.has(factory.type)) {
			factories.set(factory.type, factory);
		}
	}
}

/** Whether a factory for the given source type is available. */
export function hasAdapterFactory(type: string): boolean {
	ensureExternalLoaded();
	return factories.has(type);
}

/** List all registered source types. */
export function listAdapterTypes(): string[] {
	ensureExternalLoaded();
	return Array.from(factories.keys());
}

/** Get a factory by type, or undefined when unavailable (e.g. EE type in CE). */
export function getAdapterFactory(
	type: string
): DataSourceAdapterFactory | undefined {
	ensureExternalLoaded();
	return factories.get(type);
}

/** Get the static type descriptor for a source type, when registered. */
export function getSourceTypeDescriptor(
	type: string
): SourceTypeDescriptor | undefined {
	ensureExternalLoaded();
	return factories.get(type)?.describe();
}

/**
 * List static type descriptors for all registered source types. By default
 * internal-only "stack" umbrella types (grafana/victoria) are excluded so
 * source pickers only offer atomic types; pass `{ includeInternal: true }` to
 * include them (e.g. for the stack-template builder).
 */
export function listSourceTypeDescriptors(
	opts: { includeInternal?: boolean } = {}
): SourceTypeDescriptor[] {
	ensureExternalLoaded();
	const out: SourceTypeDescriptor[] = [];
	for (const factory of Array.from(factories.values())) {
		const descriptor = factory.describe();
		if (descriptor.internal && !opts.includeInternal) continue;
		out.push(descriptor);
	}
	return out;
}

/**
 * Build a concrete adapter for a resolved descriptor. Returns undefined when
 * no factory is registered for the descriptor's type (e.g. an externally
 * configured source running on CE).
 */
export function createAdapter(
	descriptor: TelemetrySourceDescriptor
): DataSourceAdapter | undefined {
	const factory = getAdapterFactory(descriptor.type);
	return factory?.create(descriptor);
}

/** Test-only: clear registry state. */
export function __resetRegistryForTests(): void {
	factories.clear();
	externalLoaded = false;
}
