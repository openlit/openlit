import { captureInstanceSnapshot } from "@/lib/platform/telemetry-snapshot";

/**
 * Cron-triggered endpoint that emits the daily anonymous
 * INSTANCE_TELEMETRY_SNAPSHOT event (aggregate inventory + world-total
 * ingestion counts) to PostHog.
 *
 * Authentication is enforced in middleware against CRON_JOB_ROUTES using
 * `CRON_JOB_SECRET` (or the literal "true" when unset). Do not re-check
 * the header here with a hard-coded "true" — that breaks installs that
 * set a real secret.
 */

const runningLock = { active: false };

export async function POST() {
	if (runningLock.active) {
		return Response.json(
			{ success: false, reason: "already_running" },
			{ status: 202 }
		);
	}
	runningLock.active = true;

	try {
		const result = await captureInstanceSnapshot();
		return Response.json(result);
	} catch (e) {
		console.error("[telemetry snapshot] failed", e);
		return Response.json(
			{ success: false, error: "snapshot_failed" },
			{ status: 500 }
		);
	} finally {
		runningLock.active = false;
	}
}
