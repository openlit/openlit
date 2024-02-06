"use client";
import RequestTable from "./request-table";
import { useFilter } from "../filter-context";
import { useCallback, useEffect, useState } from "react";
import { getData } from "@/utils/api";
import RequestFilter, { FilterConfigProps } from "./request-filter";
import { RequestProvider } from "./request-context";

export default function RequestPage() {
	const [filter] = useFilter();
	const [data, setData] = useState<Array<any>>([]);
	const [config, setConfig] = useState<FilterConfigProps | undefined>();
	const fetchData = useCallback(async () => {
		const res = await getData({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
				// TODO: send config true based on if the config has not already been fetched or when the timeLimit is changed
				config: {
					endpoints: true,
					maxUsageCost: true,
					models: true,
					totalRows: true,
				},
				limit: filter.limit,
				offset: filter.offset,
			}),
			method: "POST",
			url: "/api/metrics/request",
		});

		if (res?.config) setConfig(res.config);
		setData(res?.records || []);
	}, [filter]);

	useEffect(() => {
		if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
	}, [filter, fetchData]);

	return (
		<RequestProvider>
			<div className="flex flex-col grow w-full h-full rounded overflow-hidden">
				<RequestFilter config={config} />
				<RequestTable data={data} />
			</div>
		</RequestProvider>
	);
}
