/**
 * Memory connector adapter registry (CE).
 *
 * Holds adapter factories keyed by connector type. `bootstrap.ts` registers
 * Mem0 and Zep. Extra private factories can still be contributed through the
 * neutral `getExternalMemoryAdapters()` hook without an `@/ee/**` import.
 */

import { getExternalMemoryAdapters } from "./enterprise";
import type {
	MemoryAdapter,
	MemoryAdapterFactory,
	MemorySourceDescriptor,
	MemoryTypeDescriptor,
} from "./types";

const factories = new Map<string, MemoryAdapterFactory>();
let externalLoaded = false;

export function registerMemoryAdapterFactory(factory: MemoryAdapterFactory): void {
	factories.set(factory.type, factory);
}

function ensureExternalLoaded(): void {
	if (externalLoaded) return;
	externalLoaded = true;
	for (const factory of getExternalMemoryAdapters()) {
		if (!factories.has(factory.type)) {
			factories.set(factory.type, factory);
		}
	}
}

export function hasMemoryAdapterFactory(type: string): boolean {
	ensureExternalLoaded();
	return factories.has(type);
}

export function getMemoryAdapterFactory(
	type: string
): MemoryAdapterFactory | undefined {
	ensureExternalLoaded();
	return factories.get(type);
}

export function getMemoryTypeDescriptor(
	type: string
): MemoryTypeDescriptor | undefined {
	ensureExternalLoaded();
	return factories.get(type)?.describe();
}

export function listMemoryTypeDescriptors(
	_opts: { includeInternal?: boolean } = {}
): MemoryTypeDescriptor[] {
	ensureExternalLoaded();
	const out: MemoryTypeDescriptor[] = [];
	for (const factory of Array.from(factories.values())) {
		const descriptor = factory.describe();
		if (descriptor.internal) continue;
		out.push(descriptor);
	}
	return out;
}

export function createMemoryAdapter(
	descriptor: MemorySourceDescriptor
): MemoryAdapter | undefined {
	const factory = getMemoryAdapterFactory(descriptor.type);
	return factory?.create(descriptor);
}

export function __resetMemoryRegistryForTests(): void {
	factories.clear();
	externalLoaded = false;
}
