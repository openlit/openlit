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
		rawQuery?: boolean;
	} | null;
}

export type SignalCapabilities = Record<Signal, ResolvedSignalCapability | null>;

const TTL_MS = 60_000;
let cache: { value: SignalCapabilities; expiresAt: number } | null = null;
let inFlight: Promise<SignalCapabilities | null> | null = null;

async function fetchSignalCapabilities(): Promise<SignalCapabilities | null> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) return cache.value;
	if (inFlight) return inFlight;
	inFlight = (async () => {
		try {
			const res = await fetch("/api/telemetry-source");
			if (!res.ok) return null;
			const body = await res.json();
			const value = (body?.signalCapabilities ?? null) as SignalCapabilities | null;
			if (value) cache = { value, expiresAt: Date.now() + TTL_MS };
			return value;
		} catch {
			return null;
		} finally {
			inFlight = null;
		}
	})();
	return inFlight;
}

/**
 * Fetch (once, cached) the current project's resolved per-signal capabilities
 * so UI surfaces can gate honestly — showing a "not supported by this source"
 * state instead of erroring on an operation the bound source cannot serve.
 */
export function useSignalCapabilities(): {
	capabilities: SignalCapabilities | null;
	loading: boolean;
} {
	const [capabilities, setCapabilities] = useState<SignalCapabilities | null>(
		cache && cache.expiresAt > Date.now() ? cache.value : null
	);
	const [loading, setLoading] = useState(!capabilities);

	useEffect(() => {
		let active = true;
		fetchSignalCapabilities().then((value) => {
			if (!active) return;
			setCapabilities(value);
			setLoading(false);
		});
		return () => {
			active = false;
		};
	}, []);

	return { capabilities, loading };
}

/** Test-only. */
export function __clearSignalCapabilitiesCache() {
	cache = null;
	inFlight = null;
}
