/**
 * Adapter bootstrap for the CE datasource connectors: ClickHouse, Tempo, Loki,
 * Prometheus, and Jaeger. Enterprise builds may contribute additional factories
 * through the neutral extension hook.
 */

import { hasAdapterFactory, registerAdapterFactory } from "./registry";
import { clickHouseAdapterFactory } from "./clickhouse/adapter";
import { tempoAdapterFactory } from "./grafana/tempo";
import { lokiAdapterFactory } from "./grafana/loki";
import { prometheusAdapterFactory } from "./prometheus/adapter";
import { jaegerAdapterFactory } from "./jaeger/adapter";
import { getExternalDataSourceAdapters } from "@/lib/platform/connectors/datasource/enterprise";
import { registerDatasourceConnectorTypes } from "@/lib/platform/connectors/datasource";

const VENDOR_FACTORIES = [
	tempoAdapterFactory,
	lokiAdapterFactory,
	prometheusAdapterFactory,
	jaegerAdapterFactory,
];

let registered = false;

/**
 * Register CE (+ external) adapter factories.
 *
 * Re-registers when the registry Map is empty even if this module previously
 * marked itself registered. Next.js HMR can reload `registry.ts` into a fresh
 * empty Map while leaving this module's `registered` flag set, which would
 * otherwise make create/list reject known types such as `loki` with 400.
 */
export function ensureAdaptersRegistered(): void {
	if (registered && hasAdapterFactory("clickhouse") && hasAdapterFactory("loki")) {
		return;
	}
	registered = true;
	registerAdapterFactory(clickHouseAdapterFactory);
	for (const factory of VENDOR_FACTORIES) {
		registerAdapterFactory(factory);
	}
	for (const factory of getExternalDataSourceAdapters()) {
		registerAdapterFactory(factory);
	}
	registerDatasourceConnectorTypes();
}

/** Test-only: allow re-registration. */
export function __resetBootstrapForTests(): void {
	registered = false;
}
