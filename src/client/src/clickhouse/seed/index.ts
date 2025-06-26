import CreateCustomDashboardsSeed from "./dashboards";

export default async function seed() {
	return Promise.all([
		CreateCustomDashboardsSeed(),
	]);
}