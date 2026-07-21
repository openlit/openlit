/**
 * Telemetry-snapshot cron registration. Mirrors the
 * restoreAgentsMaterializeCron / restorePricingCronJobs pattern so the daily
 * anonymous instance snapshot survives container restarts and deployments.
 */

import path from "path";
import Cron from "@/helpers/server/cron";

const CRON_ID = "openlit-telemetry-snapshot";
// Once a day at a fixed minute. Overridable for testing via env.
const DEFAULT_SCHEDULE = "17 3 * * *";

/** Install (or refresh) the telemetry-snapshot cron entry. */
export async function restoreTelemetrySnapshotCron(apiURL: string) {
	// Respect the global opt-out — don't schedule anything when telemetry is off.
	if (process.env.TELEMETRY_ENABLED === "false") {
		try {
			new Cron().deleteCronJob(CRON_ID);
		} catch {
			// best-effort; nothing to clean up on a fresh install
		}
		console.log("Telemetry disabled; skipping telemetry snapshot cron");
		return;
	}

	try {
		const cron = new Cron();
		cron.updateCrontab({
			cronId: CRON_ID,
			cronSchedule:
				process.env.TELEMETRY_SNAPSHOT_SCHEDULE || DEFAULT_SCHEDULE,
			cronEnvVars: {
				API_URL: apiURL,
				CRON_ID,
			},
			cronScriptPath: path.join(
				process.cwd(),
				"scripts/telemetry-snapshot/snapshot.js"
			),
			cronLogPath: path.join(
				process.cwd(),
				"logs/telemetry-snapshot/snapshot.log"
			),
		});
		console.log("Installed telemetry snapshot cron");
	} catch (e) {
		console.error("Failed to install telemetry snapshot cron:", e);
	}
}
