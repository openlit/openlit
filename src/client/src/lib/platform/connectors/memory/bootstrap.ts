/**
 * Adapter bootstrap for CE memory connectors: Claude, Mem0, and Zep.
 * Enterprise builds may contribute additional factories through the
 * neutral extension hook.
 */

import { getExternalMemoryAdapters } from "./enterprise";
import { claudeAdapterFactory } from "./claude/adapter";
import { mem0AdapterFactory } from "./mem0/adapter";
import {
	hasMemoryAdapterFactory,
	registerMemoryAdapterFactory,
} from "./registry";
import { zepAdapterFactory } from "./zep/adapter";
import { registerMemoryConnectorTypes } from "./index";

const VENDOR_FACTORIES = [
	claudeAdapterFactory,
	mem0AdapterFactory,
	zepAdapterFactory,
];

let registered = false;

/**
 * Register CE (+ external) memory adapter factories.
 *
 * Re-registers when the registry Map is empty even if this module previously
 * marked itself registered, matching datasource bootstrap HMR behaviour.
 */
export function ensureMemoryAdaptersRegistered(): void {
	if (
		registered &&
		hasMemoryAdapterFactory("claude") &&
		hasMemoryAdapterFactory("mem0") &&
		hasMemoryAdapterFactory("zep")
	) {
		return;
	}
	registered = true;
	for (const factory of VENDOR_FACTORIES) {
		registerMemoryAdapterFactory(factory);
	}
	for (const factory of getExternalMemoryAdapters()) {
		registerMemoryAdapterFactory(factory);
	}
	registerMemoryConnectorTypes();
}

/** Test-only: allow re-registration. */
export function __resetMemoryBootstrapForTests(): void {
	registered = false;
}
