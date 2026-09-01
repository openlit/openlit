import { createHash } from "crypto";

/**
 * Per-event success sample rates (0–1). Failures are always captured.
 * High-volume widget queries are bucketed hourly so repeated refreshes in the
 * same window do not flood PostHog while still spreading coverage across widgets.
 */
const SUCCESS_SAMPLE_RATES: Record<string, number> = {
	DASHBOARD_QUERY_RUN_SUCCESS: 0.1,
};

function parseSampleRate(value: string | undefined): number | undefined {
	if (value === undefined || value.trim() === "") return undefined;
	const parsed = Number.parseFloat(value);
	if (!Number.isFinite(parsed)) return undefined;
	if (parsed <= 0) return 0;
	if (parsed >= 1) return 1;
	return parsed;
}

function resolveSuccessSampleRate(event: string): number {
	const envOverride = parseSampleRate(
		process.env.POSTHOG_DASHBOARD_QUERY_SAMPLE_RATE
	);
	if (event === "DASHBOARD_QUERY_RUN_SUCCESS" && envOverride !== undefined) {
		return envOverride;
	}
	return SUCCESS_SAMPLE_RATES[event] ?? 1;
}

export function shouldCaptureServerTelemetryEvent(
	event: string,
	sampleKey?: string
): boolean {
	if (event.endsWith("_FAILURE")) return true;

	const rate = resolveSuccessSampleRate(event);
	if (rate >= 1) return true;
	if (rate <= 0) return false;

	const key = sampleKey || "global";
	const hourBucket = Math.floor(Date.now() / 3_600_000);
	const hash = createHash("sha256")
		.update(`${event}:${key}:${hourBucket}`)
		.digest();
	const normalized = hash.readUInt32BE(0) / 0xffffffff;
	return normalized < rate;
}
