"use client";
import Filter from "../../../components/(playground)/filter";
import DataCharts from "./data-charts";
import NumberStats from "./number-stats";
import RequestsPerTime from "./requests-per-time";
import TokenCharts from "./token-charts";

export default function PlaygroundPage() {
	return (
		<>
			<Filter />
			<div className="flex flex-col grow w-full h-full rounded overflow-y-auto gap-4">
				<NumberStats />
				<div className="flex flex-col gap-4">
					<RequestsPerTime />
					<DataCharts />
					<TokenCharts />
				</div>
			</div>
		</>
	);
}
