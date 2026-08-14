/**
 * Register every connector category that this build can serve.
 *
 * Datasource adapters remain the source of truth for telemetry vendors;
 * memory adapters register through the same generic connector registry.
 */

import { ensureAdaptersRegistered } from "./datasource/bootstrap";
import { ensureMemoryAdaptersRegistered } from "./memory/bootstrap";

export function ensureConnectorsRegistered(): void {
	ensureAdaptersRegistered();
	ensureMemoryAdaptersRegistered();
}
