import { useCallback, useEffect, useState } from "react";
import { useFilter } from "../filter-context";
import Card from "@/components/common/card";
import { getData } from "@/utils/api";
import { LineChart } from "@tremor/react";

const RequestsPerTime = () => {
	const [filter] = useFilter();

	const [data, setData] = useState<Array<any>>([]);
	const fetchData = useCallback(async () => {
		const res = await getData({
			body: JSON.stringify({
				timeLimit: filter.timeLimit,
			}),
			method: "POST",
			url: "/api/metrics/request/time",
		});

		setData(res?.data || []);
	}, [filter]);

	useEffect(() => {
		if (filter.timeLimit.start && filter.timeLimit.end) fetchData();
	}, [filter, fetchData]);

	return (
		<Card heading="Requests per time" containerClass="rounded-lg">
			<LineChart
				className="mt-6"
				data={data}
				index="request_time"
				categories={["total"]}
				colors={["emerald"]}
				yAxisWidth={40}
			/>
		</Card>
	);
};

export default RequestsPerTime;
