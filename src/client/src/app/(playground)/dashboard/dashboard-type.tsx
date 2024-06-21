import { useRootStore } from "@/store";
import { getDashboardType, setDashboardType } from "@/selectors/dashboard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DASHBOARD_TYPE_OBJECT } from "@/store/dashboard";
import LLMDashboard from "./llm";
import GPUDashboard from "./gpu";

const DashboardLabels: any = {
	llm: "LLM",
	vector: "VECTOR DB",
	gpu: "GPU",
};

export function DashboardTypeFilter() {
	const dashboardType = useRootStore(getDashboardType);
	const updateDashboardType = useRootStore(setDashboardType);
	return (
		<Tabs defaultValue={dashboardType} onValueChange={updateDashboardType}>
			<TabsList>
				{Object.keys(DASHBOARD_TYPE_OBJECT).map((key) => (
					<TabsTrigger key={key} value={key}>
						{DashboardLabels[key as any]}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
}

export function DashboardTypeGraphContainer() {
	const dashboardType = useRootStore(getDashboardType);

	return (
		<div className="flex flex-col grow w-full h-full rounded overflow-y-auto gap-4">
			{dashboardType === DASHBOARD_TYPE_OBJECT.llm ? (
				<LLMDashboard />
			) : dashboardType ===
			  DASHBOARD_TYPE_OBJECT.vector ? null : dashboardType ===
			  DASHBOARD_TYPE_OBJECT.gpu ? (
				<GPUDashboard />
			) : null}
		</div>
	);
}
