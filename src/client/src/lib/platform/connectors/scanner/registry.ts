/**
 * Scanner connector adapter registry (CE).
 *
 * Holds adapter factories keyed by connector type. `bootstrap.ts` registers
 * Trustabl. Extra private factories can still be contributed through the
 * neutral `getExternalScannerAdapters()` hook without an `@/ee/**` import.
 */

import { getExternalScannerAdapters } from "./enterprise";
import type {
	ScannerAdapter,
	ScannerAdapterFactory,
	ScannerSourceDescriptor,
	ScannerTypeDescriptor,
} from "./types";

const factories = new Map<string, ScannerAdapterFactory>();
let externalLoaded = false;

export function registerScannerAdapterFactory(factory: ScannerAdapterFactory): void {
	factories.set(factory.type, factory);
}

function ensureExternalLoaded(): void {
	if (externalLoaded) return;
	externalLoaded = true;
	for (const factory of getExternalScannerAdapters()) {
		if (!factories.has(factory.type)) {
			factories.set(factory.type, factory);
		}
	}
}

export function hasScannerAdapterFactory(type: string): boolean {
	ensureExternalLoaded();
	return factories.has(type);
}

export function getScannerAdapterFactory(
	type: string
): ScannerAdapterFactory | undefined {
	ensureExternalLoaded();
	return factories.get(type);
}

export function getScannerTypeDescriptor(
	type: string
): ScannerTypeDescriptor | undefined {
	ensureExternalLoaded();
	return factories.get(type)?.describe();
}

export function listScannerTypeDescriptors(
	_opts: { includeInternal?: boolean } = {}
): ScannerTypeDescriptor[] {
	ensureExternalLoaded();
	const out: ScannerTypeDescriptor[] = [];
	for (const factory of Array.from(factories.values())) {
		const descriptor = factory.describe();
		if (descriptor.internal) continue;
		out.push(descriptor);
	}
	return out;
}

export function createScannerAdapter(
	descriptor: ScannerSourceDescriptor
): ScannerAdapter | undefined {
	const factory = getScannerAdapterFactory(descriptor.type);
	return factory?.create(descriptor);
}

export function __resetScannerRegistryForTests(): void {
	factories.clear();
	externalLoaded = false;
}
