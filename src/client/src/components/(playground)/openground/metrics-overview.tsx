"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	TrendingDownIcon,
	ZapIcon,
	CoinsIcon,
	CheckCircle2Icon,
} from "lucide-react";
import { ProviderResult } from "@/lib/platform/openground-clickhouse";
import getMessage from "@/constants/messages";

interface MetricsOverviewProps {
	data: ProviderResult[];
}

export default function MetricsOverview({ data }: MetricsOverviewProps) {
	const successfulProviders = data.filter((p) => !p.error).map((p) => ({
		...p,
		cost: Number(p.cost) || 0,
		promptTokens: Number(p.promptTokens) || 0,
		completionTokens: Number(p.completionTokens) || 0,
		totalTokens: Number(p.totalTokens) || 0,
		responseTime: Number(p.responseTime) || 0,
	}));
	const totalProviders = data.length;
	const successRate = Math.round((successfulProviders.length / totalProviders) * 100);

	// Find fastest response
	const fastest = successfulProviders.reduce((min, p) =>
		p.responseTime < min.responseTime ? p : min
		, successfulProviders[0] || { responseTime: 0, provider: "", model: "" });

	// Find lowest cost
	const cheapest = successfulProviders.reduce((min, p) =>
		p.cost < min.cost ? p : min
		, successfulProviders[0] || { cost: 0, provider: "", model: "" });

	// Find most token efficient
	const mostEfficient = successfulProviders.reduce((min, p) =>
		p.completionTokens < min.completionTokens ? p : min
		, successfulProviders[0] || { completionTokens: 0, provider: "", model: "" });

	const m = getMessage();
	const successRateClass =
		successRate === 100
			? "text-emerald-600 dark:text-emerald-400"
			: successRate >= 50
				? "text-amber-600 dark:text-amber-400"
				: "text-rose-600 dark:text-rose-400";

	const stats = [
		{
			title: m.OPENGROUND_FASTEST_RESPONSE,
			value: `${fastest.responseTime.toFixed(2)}s`,
			subtitle: fastest.provider ? `${fastest.provider}/${fastest.model}` : "",
			icon: ZapIcon,
			valueClass: "text-primary",
		},
		{
			title: m.OPENGROUND_LOWEST_COST,
			value: `$${cheapest.cost.toFixed(4)}`,
			subtitle: cheapest.provider ? `${cheapest.provider}/${cheapest.model}` : "",
			icon: CoinsIcon,
			valueClass: "text-primary",
		},
		{
			title: m.OPENGROUND_MOST_EFFICIENT,
			value: `${mostEfficient.completionTokens.toLocaleString()} ${m.OPENGROUND_LIST_TOKENS_SUFFIX}`,
			subtitle: mostEfficient.provider ? `${mostEfficient.provider}/${mostEfficient.model}` : "",
			icon: TrendingDownIcon,
			valueClass: "text-primary",
		},
		{
			title: m.OPENGROUND_SUCCESS_RATE,
			value: `${successRate}%`,
			subtitle: `${successfulProviders.length}/${totalProviders} ${m.PROVIDERS}`,
			icon: CheckCircle2Icon,
			valueClass: successRateClass,
		},
	];

	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
			{stats.map((stat) => {
				const Icon = stat.icon;
				return (
					<Card
						key={stat.title}
						className="relative overflow-hidden border border-stone-200 dark:border-stone-800"
					>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium text-stone-950 dark:text-white">
								{stat.title}
							</CardTitle>
							<span className="absolute -right-2 -top-2 rounded-bl-3xl bg-stone-200 p-3 dark:bg-stone-800">
								<Icon className="h-6 w-6 text-stone-500 dark:text-stone-100" />
							</span>
						</CardHeader>
						<CardContent>
							<div
								className={`max-w-full truncate text-3xl font-semibold ${stat.valueClass}`}
								title={stat.value}
							>
								{stat.value}
							</div>
							<p
								className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400"
								title={stat.subtitle}
							>
								{stat.subtitle}
							</p>
						</CardContent>
					</Card>
				);
			})}
		</div>
	);
}
