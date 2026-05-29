// Environment variables for auto pricing
const PRICING_CONFIG_ID = process.env.PRICING_CONFIG_ID;
const CRON_ID = process.env.CRON_ID;
const API_URL = process.env.API_URL;

// Validate required environment variables
if (!PRICING_CONFIG_ID || !CRON_ID || !API_URL) {
	console.error("[ERROR] Missing required environment variables");
	process.exit(1);
}

// Prepare request payload
const payload = JSON.stringify({
	pricingConfigId: PRICING_CONFIG_ID,
	cronId: CRON_ID,
});

async function callApi() {
	const startTime = new Date().toISOString();
	console.log(`[${startTime}] Starting auto pricing update`);

	try {
		// Make API request
		const response = await fetch(`${API_URL}/api/pricing/auto`, {
			method: "POST",
			body: payload,
			headers: {
				"Content-Type": "application/json",
				"X-CRON-JOB": "true",
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const { err, success } = await response.json();
		if (success) {
			const endTime = new Date().toISOString();
			console.log(`[${endTime}] Auto pricing update completed successfully`);
		}

		if (err) {
			throw new Error(err);
		}
	} catch (error) {
		const errorTime = new Date().toISOString();
		console.error(
			`[${errorTime}] Auto pricing update saw some error: ${error.message}`
		);
	}
}

// Execute auto pricing update
callApi();
