/**
 * Agents materializer cron registration. Mirrors the
 * restoreEvaluationCronJobs / restorePricingCronJobs pattern so the cron
 * survives container restarts and code deployments.
 */

import path from "path";
import Cron from "@/helpers/server/cron";

const CRON_ID = "openlit-agents-materialize";
const DEFAULT_SCHEDULE = "* * * * *"; // every minute; the script self-throttles when no work

/** Install (or refresh) the agents-materialize cron entry. */
export async function restoreAgentsMaterializeCron(apiURL: string) {
	try {
		const cron = new Cron();
		cron.updateCrontab({
			cronId: CRON_ID,
			cronSchedule: process.env.AGENTS_MATERIALIZE_SCHEDULE || DEFAULT_SCHEDULE,
			cronEnvVars: {
				API_URL: apiURL,
				CRON_ID,
			},
			cronScriptPath: path.join(
				process.cwd(),
				"scripts/agents/materialize.js"
			),
			cronLogPath: path.join(process.cwd(), "logs/agents/materialize.log"),
		});
		console.log("Installed agents materialize cron");
	} catch (e) {
		console.error("Failed to install agents materialize cron:", e);
	}
}
