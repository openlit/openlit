/**
 * Neutral extension hook for additional memory connector adapters.
 *
 * CE memory vendors (Claude, Mem0, Zep) are registered via `bootstrap.ts`. This hook
 * stays empty in CE so a private fork can contribute extra factories without
 * importing `@/ee/**` from shared code.
 */

import type { MemoryAdapterFactory } from "./types";

/** CE no-op: no extra private memory adapters beyond the CE bootstrap set. */
export function getExternalMemoryAdapters(): MemoryAdapterFactory[] {
	return [];
}
