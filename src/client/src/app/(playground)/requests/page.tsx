"use client";
import Table from "@/components/common/table";
import Filter from "../filter";
import { useFilter } from "../filter-context";
import { useCallback, useEffect, useState } from "react";
import { getData } from "@/utils/api";

function RequestWithData() {
	const [filter] = useFilter();
	const [data, setData] = useState<Array<any>>([]);
	const fetchData = useCallback(async () => {
		const res = await getData({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
				config: {
					endpoints: true,
					maxUsageCost: true,
					models: true,
					totalRows: true,
				},
			}),
			method: "POST",
			url: "/api/metrics/request",
		});

		setData(res?.records || []);
	}, [filter]);

	useEffect(() => {
		if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
	}, [filter, fetchData]);

	return <Table data={data} />;
}

export default function RequestPage() {
	return (
		<div className="flex flex-col grow w-full h-full rounded overflow-hidden">
			<Filter />
			<div className="flex flex-col p-2 grow w-full h-full rounded overflow-y-auto">
				<RequestWithData />
			</div>
		</div>
	);
}
