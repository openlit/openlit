import { importBoardLayout } from "@/lib/platform/manage-dashboard/board";
import llmDashboard from "../seed-data/openlit-dashboard-LLM-dashboard-layout.json";
import vectorDbDashboard from "../seed-data/openlit-dashboard-Vector-DB-layout.json";
import gpuDashboard from "../seed-data/openlit-dashboard-GPU-dashboard-layout.json";

export default async function CreateCustomDashboardsSeed() {
	console.log(
		`********* Seeding Dashboards *********`
	);
	const { err: llmDashboardErr } = await importBoardLayout(llmDashboard);
	const { err: vectorDbDashboardErr } = await importBoardLayout(vectorDbDashboard);
	const { err: gpuDashboardErr } = await importBoardLayout(gpuDashboard);

	if (llmDashboardErr || vectorDbDashboardErr || gpuDashboardErr) {
		console.log(
			`********* Seeding Dashboards Failed *********`
		);
		console.log(llmDashboardErr, vectorDbDashboardErr, gpuDashboardErr);
		return;
	}

	console.log(
		`********* Seeding Dashboards Completed *********`
	);
}