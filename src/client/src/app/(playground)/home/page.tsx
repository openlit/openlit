"use client";

import Filter from "@/components/(playground)/filter";
import { useEffect, useMemo, useState } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useRouter, useSearchParams } from "next/navigation";
import Dashboard, {
	DashboardConfig,
} from "../../../components/(playground)/manage-dashboard/board-creator";
import { useRootStore } from "@/store";
import { getFilterDetails } from "@/selectors/filter";
import { getCurrentOrganisation } from "@/selectors/organisation";
import {
	getCurrentProject,
	getProjectIsLoading,
	getProjectList,
} from "@/selectors/project";
import {
	getDatabaseConfigList,
	getDatabaseConfigListIsLoading,
} from "@/selectors/database-config";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import { fetchProjectList } from "@/helpers/client/project";
import { fetchDatabaseConfigList } from "@/helpers/client/database-config";
import Loader from "@/components/common/loader";
import { usePageHeader } from "@/selectors/page";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { toast } from "sonner";
import BoardList from "./board-list";
import DescriptionTooltip from "@/components/common/description-tooltip";
import { BookText } from "lucide-react";

export default function DashboardPage() {
	const router = useRouter();
	const filter = useRootStore(getFilterDetails);
	const currentOrg = useRootStore(getCurrentOrganisation);
	const projects = useRootStore(getProjectList);
	const currentProject = useRootStore(getCurrentProject);
	const isProjectLoading = useRootStore(getProjectIsLoading);
	const databaseConfigs = useRootStore(getDatabaseConfigList);
	const isDatabaseConfigLoading = useRootStore(getDatabaseConfigListIsLoading);
	const { fireRequest, isLoading } = useFetchWrapper();
	const { fireRequest: fireRunQuery } = useFetchWrapper();
	const [initialConfig, setInitialConfig] = useState<
		DashboardConfig | undefined
	>();
	const searchParams = useSearchParams();
	const dashboardId = searchParams.get("dashboardId");
	const { setHeader } = usePageHeader();
	const posthog = usePostHog();
	const hasProject = Boolean(currentProject?.id && (projects?.length || 0) > 0);
	const hasDbConfig = Boolean(databaseConfigs?.length);
	const isSetupLoading =
		isProjectLoading ||
		isDatabaseConfigLoading ||
		projects === undefined ||
		(hasProject && databaseConfigs === undefined);

	useEffect(() => {
		if (currentOrg?.id) {
			fetchProjectList(currentOrg.id);
		}
	}, [currentOrg?.id]);

	useEffect(() => {
		if (currentProject?.id) {
			fetchDatabaseConfigList(() => {});
		}
	}, [currentProject?.id]);

	useEffect(() => {
		if (!isSetupLoading && (!currentOrg?.id || !hasProject || !hasDbConfig)) {
			router.replace("/onboarding");
		}
	}, [currentOrg?.id, hasDbConfig, hasProject, isSetupLoading, router]);

	useEffect(() => {
		if (isSetupLoading || !hasProject || !hasDbConfig) return;
		const fetchBoardLayout = async () => {
			try {
				setInitialConfig(undefined);
				const { response, error } = await fireRequest({
					requestType: "GET",
					url: `/api/manage-dashboard/board/${dashboardId ? dashboardId : "main"}/layout`,
				});

				if (error) {
					throw new Error(error);
				}

				if (response?.data) {
					setInitialConfig(response.data);
					setHeader({
						title: response.data?.title,
						description: response.data?.description,
						breadcrumbs: [],
					});
					posthog?.capture(CLIENT_EVENTS.DASHBOARD_VIEWED, {
						id: response.data.id,
						home: true,
						mainDashboard: response.data.isMainDashboard,
					});
				}
			} catch (error) {
				toast.error("Failed to fetch board layout", {
					id: "dashboard-page",
				});
				posthog?.capture(CLIENT_EVENTS.DASHBOARD_VIEW_FAILURE, {
					error: error?.toString(),
					home: true,
					mainDashboard: !dashboardId,
				});
			}
		};

		fetchBoardLayout();
	}, [dashboardId, fireRequest, hasDbConfig, hasProject, isSetupLoading]);

	const runFilters = useMemo(() => {
		return getFilterParamsForDashboard({
			...filter,
		});
	}, [filter]);

	const runQuery = async (
		widgetId: string,
		params: Record<string, unknown>
	) => {
		const data = await fireRunQuery({
			requestType: "POST",
			url: "/api/manage-dashboard/query/run",
			body: JSON.stringify({
				widgetId,
				filter: runFilters,
				...params,
			}),
		});

		return data.response;
	};

	if (isSetupLoading || !hasProject || !hasDbConfig) {
		return (
			<div className="flex h-full w-full items-center justify-center">
				<Loader />
			</div>
		);
	}

	return (
		<>
			<div className="flex w-full items-center justify-between mb-4 gap-4">
				{initialConfig?.description && (
					<DescriptionTooltip
						description={initialConfig.description}
						className="ml-2 h-4 w-4"
						icon={<BookText className="text-stone-500 cursor-pointer" />}
					/>
				)}
				<Filter />
				<BoardList dashboardId={dashboardId} />
			</div>
			{isLoading ? (
				<div className="flex items-center justify-center h-full w-full">
					<Loader />
				</div>
			) : null}
			{initialConfig ? (
				<Dashboard
					className="h-100 overflow-y-auto"
					initialConfig={initialConfig}
					readonly
					runQuery={runQuery}
					runFilters={runFilters}
				/>
			) : null}
		</>
	);
}
