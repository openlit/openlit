/**
 * Adapter bootstrap for CE scanner connectors: Trustabl.
 * Enterprise builds may contribute additional factories through the
 * neutral extension hook.
 */

import { getExternalScannerAdapters } from "./enterprise";
import { trustablAdapterFactory } from "./trustabl/adapter";
import {
	hasScannerAdapterFactory,
	registerScannerAdapterFactory,
} from "./registry";
import { registerScannerConnectorTypes } from "./index";

const VENDOR_FACTORIES = [trustablAdapterFactory];

let registered = false;

export function ensureScannerAdaptersRegistered(): void {
	if (registered && hasScannerAdapterFactory("trustabl")) {
		return;
	}
	registered = true;
	for (const factory of VENDOR_FACTORIES) {
		registerScannerAdapterFactory(factory);
	}
	for (const factory of getExternalScannerAdapters()) {
		registerScannerAdapterFactory(factory);
	}
	registerScannerConnectorTypes();
}

export function __resetScannerBootstrapForTests(): void {
	registered = false;
}
