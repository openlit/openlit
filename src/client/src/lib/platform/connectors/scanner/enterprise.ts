/**
 * Neutral extension hook for additional scanner connector adapters.
 *
 * CE scanner vendors (Trustabl) are registered via `bootstrap.ts`. This hook
 * stays empty in CE so a private fork can contribute extra factories without
 * importing `@/ee/**` from shared code.
 */

import type { ScannerAdapterFactory } from "./types";

/** CE no-op: no extra private scanner adapters beyond the CE bootstrap set. */
export function getExternalScannerAdapters(): ScannerAdapterFactory[] {
	return [];
}
