"use client";
import Filter from "@/components/(playground)/filter";
import { useCallback, useEffect, useMemo, useState } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useSearchParams } from "next/navigation";
import Dashboard, { DashboardConfig } from "../../../components/(playground)/manage-dashboard/board-creator";
import { Board } from "@/types/manage-dashboard";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useRootStore } from "@/store";
import { getFilterDetails } from "@/selectors/filter";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";
import Loader from "@/components/common/loader";
import { usePageHeader } from "@/selectors/page";

const BoardList = ({ dashboardId }: { dashboardId: string | null }) => {
	const [boards, setBoards] = useState<Board[]>([]);
	const { fireRequest } = useFetchWrapper();

	const fetchBoards = useCallback(() => {
		fireRequest({
			url: "/api/manage-dashboard/board?home=true",
			requestType: "GET",
			successCb: (response) => {
				if (response?.data) {
					setBoards(response.data);
				}
			},
			failureCb: (error) => {
				setBoards([]);
			},
		});
	}, [fireRequest]);

	useEffect(() => {
		fetchBoards();
	}, [fetchBoards]);

	if (boards.length === 0) {
		return null;
	}

	return (
		<div className="flex gap-2">
			{boards.map((board) => {
				if (dashboardId === board.id || (!dashboardId && board.isMainDashboard)) {
					return null;
				}
				return (
					<Link key={board.id} href={`?dashboardId=${board.id}`}>
						<Badge>{board.title}</Badge>
					</Link>
				);
			})}
		</div>
	);
};

export default function DashboardPage() {
	const filter = useRootStore(getFilterDetails);
	const { fireRequest, isLoading } = useFetchWrapper();
	const { fireRequest: fireRunQuery } = useFetchWrapper();
	const [initialConfig, setInitialConfig] = useState<
		DashboardConfig | undefined
	>();
	const searchParams = useSearchParams();
	const dashboardId = searchParams.get("dashboardId");
	const { setHeader } = usePageHeader();

	useEffect(() => {
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
				}
			} catch (error) {
				console.error("Failed to fetch board layout:", error);
			}
		};

		fetchBoardLayout();
	}, [dashboardId, fireRequest]);

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
			// Add params of the dashboard & add a check for edit mode to send query or not through body
			body: JSON.stringify({
				widgetId,
				filter: runFilters,
				...params,
			}),
		});

		return data.response;
	};

	return (
		<>
			<div className="flex items-center w-full justify-between mb-4">
				<Filter />
				<BoardList dashboardId={dashboardId} />
			</div>
			{
				isLoading ? (
					<div className="flex items-center justify-center h-full w-full">
						<Loader />
					</div>
				) : null
			}
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
