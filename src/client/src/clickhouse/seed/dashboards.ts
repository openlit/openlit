import { importBoardLayout } from "@/lib/platform/manage-dashboard/board";
import llmDashboard from "../seed-data/openlit-dashboard-LLM dashboard-layout.json";
import vectorDbDashboard from "../seed-data/openlit-dashboard-Vector DB-layout.json";

export default async function CreateCustomDashboardsSeed() {
	await importBoardLayout(llmDashboard);
	await importBoardLayout(vectorDbDashboard);
}