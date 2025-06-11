"use client";
import Filter from "@/components/(playground)/filter";
import { useCallback, useEffect, useMemo, useState } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useSearchParams } from "next/navigation";
import Dashboard, { DashboardConfig } from "../../../components/(playground)/manage-dashboard/board-creator";
import { Board } from "@/types/manage-dashboard";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useRootStore } from "@/store";
import { getFilterDetails } from "@/selectors/filter";
import { getFilterParamsForDashboard } from "@/helpers/client/filter";

const BoardList = ({ boardId }: { boardId: string | null }) => {
	const [boards, setBoards] = useState<Board[]>([]);
	const { fireRequest } = useFetchWrapper();

	const fetchBoards = useCallback(() => {
		fireRequest({
			url: "/api/manage-dashboard/board",
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

	if (boards.length === 0) return null;

	return (
		<div className="flex gap-2">
			{boards.map((board) => {
				if (boardId === board.id || (!boardId && board.isMainDashboard)) {
					return null;
				}
				return (
					<Link key={board.id} href={`?boardId=${board.id}`}>
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
	const [initialConfig, setInitialConfig] = useState<
		DashboardConfig | undefined
	>();
	const searchParams = useSearchParams();
	const boardId = searchParams.get("boardId");

	useEffect(() => {
		const fetchBoardLayout = async () => {
			try {
				const { response, error } = await fireRequest({
					requestType: "GET",
					url: `/api/manage-dashboard/board/${boardId ? boardId : "main"}/layout`,
				});

				if (error) {
					throw new Error(error);
				}

				if (response?.data) {
					setInitialConfig(response.data);
				}
			} catch (error) {
				console.error("Failed to fetch board layout:", error);
			}
		};

		fetchBoardLayout();
	}, [boardId, fireRequest]);

	const runFilters = useMemo(() => {
		return getFilterParamsForDashboard({
			...filter,
		});
	}, [filter]);

	const runQuery = async (
		widgetId: string,
		params: {
			userQuery: string;
		}
	) => {
		const data = await fireRequest({
			requestType: "POST",
			url: "/api/manage-dashboard/query/run",
			// Add params of the dashboard & add a check for edit mode to send query or not through body
			body: JSON.stringify({
				widgetId,
				filter: runFilters,
				...params,
				respectFilters: true,
			}),
		});

		return data.response;
	};

	return (
		<>
			<div className="flex items-center w-full justify-between mb-4">
				<Filter />
				<BoardList boardId={boardId} />
			</div>
			{!initialConfig ? (
				<div className="flex items-center justify-center h-full">
					<Loader2 className="w-4 h-4 animate-spin" />
				</div>
			) : (
				<Dashboard
					className="h-100 overflow-y-auto"
					initialConfig={initialConfig}
					readonly
					renderTitle={false}
					runQuery={runQuery}
					runFilters={runFilters}
				/>
			)}
		</>
	);
}
