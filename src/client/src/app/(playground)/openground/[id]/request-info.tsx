import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";

const InfoPill = ({ title, value }: { title: string; value: any }) => {
	return (
		<Button
			variant="outline"
			size="default"
			className="text-stone-500 dark:text-stone-400 dark:bg-stone-800 cursor-default"
		>
			{title}
			<Separator
				orientation="vertical"
				className="mx-2 h-4 bg-stone-300 dark:bg-stone-600"
			/>
			<Badge
				variant="secondary"
				className="rounded-sm px-1 font-normal bg-transparent"
			>
				{value}
			</Badge>
		</Button>
	);
};

export default function RequestInfo({ data }: { data: any }) {
	return (
		<div className="flex w-full gap-4 flex-wrap">
			<InfoPill
				title="Created At"
				value={format(data.createdAt, "MMM do, y  HH:mm:ss a")}
			/>
			<InfoPill title="Created By" value={data.createdByUser.email} />
			<InfoPill title="Database Config" value={data.databaseConfig.name} />
			<InfoPill title="Total Providers" value={data.stats.totalProviders} />
			{(data.stats.errors || []).length > 0 ? (
				<InfoPill
					title="Errored Providers"
					value={(data.stats.errors || []).length}
				/>
			) : null}
			{data.stats.minCostProvider && (
				<InfoPill
					title="Min Cost"
					value={`${data.stats.minCostProvider} ($${data.stats.minCost})`}
				/>
			)}
			{data.stats.minResponseTimeProvider && (
				<InfoPill
					title="Min Response Time"
					value={`${data.stats.minResponseTimeProvider} ($${data.stats.minResponseTime}s)`}
				/>
			)}
			{data.stats.minCompletionTokensProvider && (
				<InfoPill
					title="Min Completion Tokens"
					value={`${data.stats.minCompletionTokensProvider} (${data.stats.minCompletionTokens})`}
				/>
			)}
		</div>
	);
}
