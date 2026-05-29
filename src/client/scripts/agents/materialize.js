// Agents materializer cron entrypoint.
//
// Posts to /api/agents/materialize on the running Next.js server. Doing the
// work over HTTP lets the request reuse the existing DB-config-aware
// dataCollector + Prisma pool inside the server process instead of cold-
// starting a separate ClickHouse client in the cron.

const API_URL = process.env.API_URL;
const CRON_ID = process.env.CRON_ID;

if (!API_URL || !CRON_ID) {
	console.error("[ERROR] Missing required environment variables for agents materialize cron");
	process.exit(1);
}

async function tick() {
	const startTime = new Date().toISOString();
	console.log(`[${startTime}] Starting agents materialize tick`);

	try {
		const response = await fetch(`${API_URL}/api/agents/materialize`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-CRON-JOB": "true",
				"X-CRON-ID": CRON_ID,
			},
			body: JSON.stringify({ cronId: CRON_ID }),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const body = await response.json().catch(() => ({}));
		console.log(
			`[${new Date().toISOString()}] Agents materialize tick result:`,
			body
		);
	} catch (error) {
		console.error(
			`[${new Date().toISOString()}] Agents materialize tick error: ${error.message || error}`
		);
	}
}

tick();
