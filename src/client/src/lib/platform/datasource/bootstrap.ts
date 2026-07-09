/**
 * Adapter bootstrap. Registers the built-in ClickHouse reference factory plus
 * the external vendor factories (Datadog, Grafana/Tempo/Loki/Mimir, New Relic,
 * Jaeger, Victoria stack) exactly once. These are a fundamental part of the
 * pluggable-telemetry structure and live in the shared codebase; the neutral
 * `getExternalDataSourceAdapters()` hook remains available for the enterprise
 * repo to contribute additional, private factories on top.
 */

import { registerAdapterFactory } from "./registry";
import { clickHouseAdapterFactory } from "./clickhouse/adapter";
import { datadogAdapterFactory } from "./datadog/adapter";
import { grafanaAdapterFactory } from "./grafana/umbrella";
import { tempoAdapterFactory } from "./grafana/tempo";
import { lokiAdapterFactory } from "./grafana/loki";
import {
	prometheusAdapterFactory,
	mimirAdapterFactory,
} from "./grafana/prometheus";
import { newrelicAdapterFactory } from "./newrelic/adapter";
import { jaegerAdapterFactory } from "./jaeger/adapter";
import {
	victoriaAdapterFactory,
	victoriaMetricsAdapterFactory,
} from "./victoria/umbrella";
import { victoriaLogsAdapterFactory } from "./victoria/logs";

const VENDOR_FACTORIES = [
	datadogAdapterFactory,
	grafanaAdapterFactory,
	tempoAdapterFactory,
	lokiAdapterFactory,
	prometheusAdapterFactory,
	mimirAdapterFactory,
	newrelicAdapterFactory,
	jaegerAdapterFactory,
	victoriaAdapterFactory,
	victoriaMetricsAdapterFactory,
	victoriaLogsAdapterFactory,
];

let registered = false;

export function ensureAdaptersRegistered(): void {
	if (registered) return;
	registered = true;
	registerAdapterFactory(clickHouseAdapterFactory);
	for (const factory of VENDOR_FACTORIES) {
		registerAdapterFactory(factory);
	}
}

/** Test-only: allow re-registration. */
export function __resetBootstrapForTests(): void {
	registered = false;
}
