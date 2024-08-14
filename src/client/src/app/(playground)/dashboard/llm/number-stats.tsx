import StatCard from "@/components/(playground)/stat-card";
import { TraceMapping } from "@/constants/traces";
import { integerParser } from "@/helpers/trace";
import {
	Banknote,
	Braces,
	CircleDollarSign,
	RadioTower,
	Timer,
} from "lucide-react";

function NumberStats() {
	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
			<StatCard
				dataKey="total_requests"
				extraParams={{
					operationType: "llm",
				}}
				heading="Total requests"
				icon={RadioTower}
				url="/api/metrics/request/total"
			/>
			<StatCard
				dataKey="average_duration"
				extraParams={{
					operationType: "llm",
				}}
				heading="Avg Request Duration"
				icon={Timer}
				textSuffix="s"
				parser={(value: any) =>
					integerParser(`${value}`, TraceMapping.requestDuration.offset)
				}
				url="/api/metrics/request/duration/average"
			/>
			<StatCard
				dataKey="total_tokens"
				extraParams={{ type: "total" }}
				heading="Avg tokens per request"
				icon={Braces}
				url="/api/metrics/llm/token/request/average"
			/>
			<StatCard
				dataKey="total_usage_cost"
				heading="Total costs"
				icon={CircleDollarSign}
				roundTo={7}
				textPrefix="$"
				url="/api/metrics/llm/cost/total"
			/>
			<StatCard
				dataKey="average_usage_cost"
				heading="Avg cost per request"
				icon={Banknote}
				roundTo={7}
				textPrefix="$"
				url="/api/metrics/llm/cost/request/average"
			/>
		</div>
	);
}

export default NumberStats;
