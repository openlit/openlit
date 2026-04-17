/**
 * Next.js Instrumentation Hook
 * Runs before the server starts accepting requests
 * Used to run ClickHouse migrations on startup
 */

export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		console.log("🚀 Starting server initialization...");

		try {
			// Run ClickHouse migrations before server starts
			const { runClickhouseMigrations } = await import(
				"@/lib/platform/clickhouse/helpers"
			);

			console.log("📦 Running ClickHouse migrations...");
			await runClickhouseMigrations();
			console.log("✅ ClickHouse migrations completed successfully");
		} catch (error) {
			console.error("❌ Error running ClickHouse migrations on startup:", error);
			// Don't throw - allow server to start even if migrations fail
			// This prevents the server from crashing if ClickHouse is temporarily unavailable
		}

		const apiURL =
			process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;

		try {
			// Restore cron jobs for auto-evaluations (survives new image deployments)
			const { restoreEvaluationCronJobs } = await import(
				"@/lib/platform/evaluation/config"
			);
			console.log("🔄 Restoring evaluation cron jobs...");
			await restoreEvaluationCronJobs(apiURL);
			console.log("✅ Evaluation cron jobs restored");
		} catch (error) {
			console.error("❌ Error restoring evaluation cron jobs:", error);
			// Don't throw - allow server to start even if cron restore fails
		}

		try {
			// Restore cron jobs for auto-pricing
			const { restorePricingCronJobs } = await import(
				"@/lib/platform/pricing/config"
			);
			console.log("🔄 Restoring pricing cron jobs...");
			await restorePricingCronJobs(apiURL);
			console.log("✅ Pricing cron jobs restored");
		} catch (error) {
			console.error("❌ Error restoring pricing cron jobs:", error);
			// Don't throw - allow server to start even if cron restore fails
		}

		console.log("✨ Server initialization complete");
	}
}
