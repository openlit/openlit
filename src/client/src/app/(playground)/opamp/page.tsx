"use client";
import { useEffect } from "react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { Agent } from "@/types/opamp";
import { usePageHeader } from "@/selectors/page";
import List from "./list";

export default function Opamp() {
	const { setHeader } = usePageHeader();
	const { fireRequest, data, isLoading, isFetched } = useFetchWrapper<Agent[]>();

	useEffect(() => {
		setHeader({
			title: "Opamp",
			breadcrumbs: [{
				title: "All agents",
				href: "/opamp"
			}],
		});
		fireRequest({
			requestType: "GET",
			url: `/api/opamp`,
			responseDataKey: "data",
		});
	}, []);

	return (
		<div className="flex flex-col w-full gap-3">
			{/* Feature Description Section */}
			<div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
				<div className="flex items-start space-x-4">
					<div className="flex-shrink-0">
						<div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
							<svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>
						</div>
					</div>
					<div className="flex-1">
						<h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
							OpAMP Agent Management
						</h2>
						<p className="text-gray-600 dark:text-gray-300 mb-4">
							OpAMP (Open Agent Management Protocol) provides centralized management and monitoring of OpenTelemetry agents across your infrastructure. 
							Monitor agent health, view detailed configurations, and manage agent settings from a unified dashboard.
						</p>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
							<div className="flex items-center space-x-2">
								<div className="w-2 h-2 bg-green-500 rounded-full"></div>
								<span className="text-gray-700 dark:text-gray-300">Monitor agent health status</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="w-2 h-2 bg-blue-500 rounded-full"></div>
								<span className="text-gray-700 dark:text-gray-300">View agent versions and deployment details</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="w-2 h-2 bg-purple-500 rounded-full"></div>
								<span className="text-gray-700 dark:text-gray-300">Click any agent to view detailed information</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="w-2 h-2 bg-orange-500 rounded-full"></div>
								<span className="text-gray-700 dark:text-gray-300">Manage custom agent configurations</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="w-2 h-2 bg-teal-500 rounded-full"></div>
								<span className="text-gray-700 dark:text-gray-300">Track agent start times and uptime</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="w-2 h-2 bg-red-500 rounded-full"></div>
								<span className="text-gray-700 dark:text-gray-300">Identify unhealthy agents at a glance</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Agent List */}
			<List agents={data || []} isLoading={!data || isLoading} isFetched={isFetched} />
		</div>
	);
}