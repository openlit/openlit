/**
 * Adapter bootstrap. Registers the built-in ClickHouse reference factory plus
 * the atomic external vendor factories (Datadog, Tempo, Loki, Mimir/Prometheus,
 * New Relic, Jaeger, VictoriaLogs, VictoriaMetrics) exactly once.
 *
 * Multi-backend "stack" umbrellas (grafana/victoria) are intentionally not
 * registered — stack templates in `telemetry-source-crud` expand into atomic
 * per-signal sources instead. The neutral `getExternalDataSourceAdapters()`
 * hook remains available for additional private factories.
 */

import { registerAdapterFactory } from "./registry";
import { clickHouseAdapterFactory } from "./clickhouse/adapter";
import { datadogAdapterFactory } from "./datadog/adapter";
import { tempoAdapterFactory } from "./grafana/tempo";
import { lokiAdapterFactory } from "./grafana/loki";
import {
	prometheusAdapterFactory,
	mimirAdapterFactory,
} from "./grafana/prometheus";
import { newrelicAdapterFactory } from "./newrelic/adapter";
import { jaegerAdapterFactory } from "./jaeger/adapter";
import { victoriaMetricsAdapterFactory } from "./victoria/metrics";
import { victoriaLogsAdapterFactory } from "./victoria/logs";
import { getExternalDataSourceAdapters } from "./enterprise";

const VENDOR_FACTORIES = [
	datadogAdapterFactory,
	tempoAdapterFactory,
	lokiAdapterFactory,
	prometheusAdapterFactory,
	mimirAdapterFactory,
	newrelicAdapterFactory,
	jaegerAdapterFactory,
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
	for (const factory of getExternalDataSourceAdapters()) {
		registerAdapterFactory(factory);
	}
}

/** Test-only: allow re-registration. */
export function __resetBootstrapForTests(): void {
	registered = false;
}
