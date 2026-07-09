/**
 * Neutral extension hook for external telemetry data source adapters.
 *
 * CE returns an empty list (no external adapters). The private enterprise repo
 * overrides this module from `src/client/src/ee/**` (via its path aliases /
 * thin wrappers) to register vendor adapter factories such as Datadog,
 * Tempo/Loki/Mimir, New Relic, Jaeger, and the Victoria stack.
 *
 * Mirrors the `enterpriseStoreSlices = {}` and `route-access` no-op pattern.
 * Never import `@/ee/**` from this file — it lives in CE.
 */

import type { DataSourceAdapterFactory } from "./types";

/** CE no-op: no external telemetry sources are available in open source. */
export function getExternalDataSourceAdapters(): DataSourceAdapterFactory[] {
	return [];
}
