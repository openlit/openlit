"use client";

import { useEffect, useState } from "react";

export type Signal = "traces" | "logs" | "metrics";

export interface ResolvedSignalCapability {
	sourceType: string;
	sourceName: string;
	isBuiltIn: boolean;
	capabilities: {
		traceTree?: boolean;
		spanEvents?: boolean;
		serverAggregation?: boolean;
		spanMutation?: boolean;
		distinctValues?: boolean;
		crossTraceSession?: boolean;
		maxLookbackMs?: number;
		maxTimeRangeMs?: number;
		rawQuery?: boolean;
	} | null;
}

export type SignalCapabilities = Record<Signal, ResolvedSignalCapability | null>;

const TTL_MS = 60_000;
const cache = new Map<
	string,
	{ value: SignalCapabilities; expiresAt: number }
>();
const inFlight = new Map<string, Promise<SignalCapabilities | null>>();

function getCachedCapabilities(
	environment?: string
): SignalCapabilities | null {
	const entry = cache.get(environment || "current");
	return entry && entry.expiresAt > Date.now() ? entry.value : null;
}

async function fetchSignalCapabilities(
	environment?: string
): Promise<SignalCapabilities | null> {
	const cacheKey = environment || "current";
	const now = Date.now();
	const cached = cache.get(cacheKey);
	if (cached && cached.expiresAt > now) return cached.value;
	const pending = inFlight.get(cacheKey);
	if (pending) return pending;
	const request = (async () => {
		try {
			const params = new URLSearchParams();
			if (environment) params.set("environment", environment);
			const res = await fetch(
				`/api/telemetry-source${params.size ? `?${params.toString()}` : ""}`
			);
			if (!res.ok) return null;
			const body = await res.json();
			const value = (body?.signalCapabilities ?? null) as SignalCapabilities | null;
			if (value) {
				cache.set(cacheKey, { value, expiresAt: Date.now() + TTL_MS });
			}
			return value;
		} catch {
			return null;
		} finally {
			inFlight.delete(cacheKey);
		}
	})();
	inFlight.set(cacheKey, request);
	return request;
}

/**
 * Fetch (once, cached) the current project's resolved per-signal capabilities
 * so UI surfaces can gate honestly — showing a "not supported by this source"
 * state instead of erroring on an operation the bound source cannot serve.
 */
export function useSignalCapabilities(environment?: string): {
	capabilities: SignalCapabilities | null;
	loading: boolean;
} {
	const [capabilities, setCapabilities] = useState<SignalCapabilities | null>(
		() => getCachedCapabilities(environment)
	);
	const [loading, setLoading] = useState(!capabilities);

	useEffect(() => {
		let active = true;
		const cached = getCachedCapabilities(environment);
		setCapabilities(cached);
		setLoading(!cached);
		fetchSignalCapabilities(environment).then((value) => {
			if (!active) return;
			setCapabilities(value);
			setLoading(false);
		});
		return () => {
			active = false;
		};
	}, [environment]);

	return { capabilities, loading };
}

/** Test-only. */
export function __clearSignalCapabilitiesCache() {
	cache.clear();
	inFlight.clear();
}
