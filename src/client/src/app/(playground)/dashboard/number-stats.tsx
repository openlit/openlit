import StatCard from "@/components/(playground)/stat-card";

function NumberStats() {
	return (
		<div className="flex mb-4">
			<StatCard
				containerClass="border-r-0 rounded-l-lg w-full"
				dataKey="total_requests"
				heading="Total requests"
				url="/api/metrics/request/total"
			/>
			<StatCard
				containerClass="border-r-0 w-full"
				dataKey="average_duration"
				heading="Avg Request Duration"
				textSuffix="s"
				url="/api/metrics/request/duration/average"
			/>
			<StatCard
				containerClass="rounded-r-lg w-full"
				dataKey="total_tokens"
				extraParams={{ type: "total" }}
				heading="Avg tokens per request"
				url="/api/metrics/token/request/average"
			/>
			<StatCard
				containerClass="border-r-0 w-full"
				dataKey="total_usage_cost"
				heading="Total costs"
				roundTo={7}
				textPrefix="$"
				url="/api/metrics/cost/total"
			/>
			<StatCard
				containerClass="rounded-r-lg w-full"
				dataKey="average_usage_cost"
				heading="Avg cost per request"
				roundTo={7}
				textPrefix="$"
				url="/api/metrics/cost/request/average"
			/>
		</div>
	);
}

export default NumberStats;
