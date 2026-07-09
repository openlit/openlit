/**
 * Neutral extension hook for additional telemetry data source adapters.
 *
 * Atomic vendor adapters (Datadog, Tempo, Loki, etc.) are registered in CE via
 * `bootstrap.ts`. This hook stays empty in CE so a private fork can contribute
 * extra factories without importing `@/ee/**` from shared code.
 */

import type { DataSourceAdapterFactory } from "./types";

/** CE no-op: no extra private adapters beyond the CE bootstrap set. */
export function getExternalDataSourceAdapters(): DataSourceAdapterFactory[] {
	return [];
}
