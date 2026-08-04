/**
 * Adapter bootstrap for the three CE datasource connectors: ClickHouse,
 * Tempo, and Jaeger. Enterprise builds may contribute additional factories
 * through the neutral extension hook.
 */

import { registerAdapterFactory } from "./registry";
import { clickHouseAdapterFactory } from "./clickhouse/adapter";
import { tempoAdapterFactory } from "./grafana/tempo";
import { jaegerAdapterFactory } from "./jaeger/adapter";
import { getExternalDataSourceAdapters } from "@/lib/platform/connectors/datasource/enterprise";
import { registerDatasourceConnectorTypes } from "@/lib/platform/connectors/datasource";

const VENDOR_FACTORIES = [
	tempoAdapterFactory,
	jaegerAdapterFactory,
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
	registerDatasourceConnectorTypes();
}

/** Test-only: allow re-registration. */
export function __resetBootstrapForTests(): void {
	registered = false;
}
