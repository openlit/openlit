"use client";

import { useEffect, useState } from "react";
import Dashboard from "../../board-creator";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { useParams } from "next/navigation";
import { DashboardConfig, Widget } from "../../board-creator/types";

// import Layout from "./layout";
// import DashboardOrganism from "./dashboard-organism";
// import Dashboard from "./dashboard-organism/dashboard";

export default function DashboardPage() {
	const { fireRequest } = useFetchWrapper();
	const { fireRequest: fireRequestWidget } = useFetchWrapper();
	const params = useParams();
	const boardId = params.id as string;
	const [initialConfig, setInitialConfig] = useState<
		DashboardConfig | undefined
	>();

	useEffect(() => {
		const fetchBoardLayout = async () => {
			try {
				const { response, error } = await fireRequest({
					requestType: "GET",
					url: `/api/dashlit/board/${boardId}/layout`,
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

	const runQuery = async (
		widgetId: string,
		params: {
			userQuery: string;
		}
	) => {
		const data = await fireRequest({
			requestType: "POST",
			url: "/api/dashlit/query/run",
			// Add params of the dashboard & add a check for edit mode to send query or not through body
			body: JSON.stringify({ widgetId, ...params, respectFilters: true }),
		});

		return data.response;
	};

	const handleSave = async (config: DashboardConfig) => {
		try {
			await fireRequest({
				requestType: "PUT",
				url: `/api/dashlit/board/${boardId}/layout`,
				body: JSON.stringify(config),
				failureCb: (error) => {
					throw new Error(error);
				},
			});
		} catch (error) {
			console.error("Failed to save dashboard layout:", error);
			throw error;
		}
	};

	const handleWidgetCrud = async (updates: Partial<Widget>) => {
		try {
			if (updates.id) {
				const { response, error } = await fireRequestWidget({
					requestType: "PUT",
					url: `/api/dashlit/widget/${updates.id}`,
					body: JSON.stringify(updates),
				});

				if (error) {
					throw new Error(error);
				}

				return response.data;
			} else {
				const { response, error } = await fireRequestWidget({
					requestType: "POST",
					url: `/api/dashlit/widget`,
					body: JSON.stringify(updates),
				});

				if (error) {
					throw new Error(error);
				}

				return response.data;
			}
		} catch (error) {
			console.error("Failed to update widget:", error);
			throw error;
		}
	};

	const fetchExistingWidgets = async () => {
		const { response, error } = await fireRequest({
			requestType: "GET",
			url: "/api/dashlit/widget",
		});

		if (error) {
			throw new Error(error);
		}

		return response.data;
	};

	return (
		<div className="flex flex-col items-center w-full justify-between h-full">
			<h1>Custom Dashboard</h1>
			{/* <Layout /> */}
			<div className="flex flex-col items-center w-full justify-between h-full">
				<div
					// ref={this.onMeasureRef}
					className="flex flex-col items-center w-full justify-between h-full"
				>
					<div className="w-full h-full overflow-y-auto">
						{/* <DashboardOrganism
							layout={[
								{
									x: 0,
									y: 0,
									w: 2,
									h: 4,
									i: "0",
								},
								{
									x: 2,
									y: 0,
									w: 2,
									h: 3,
									i: "1",
								},
								{
									x: 4,
									y: 0,
									w: 2,
									h: 3,
									i: "2",
								},
								{
									x: 6,
									y: 0,
									w: 2,
									h: 5,
									i: "3",
								},
							]}
							isEditable={true}
						/> */}
						{initialConfig && (
							<Dashboard
								initialConfig={initialConfig}
								runQuery={runQuery}
								onSave={handleSave}
								handleWidgetCrud={handleWidgetCrud}
								fetchExistingWidgets={fetchExistingWidgets}
							/>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
