"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProviderResult } from "@/lib/platform/openground-clickhouse";
import { DollarSignIcon } from "lucide-react";
import getMessage from "@/constants/messages";

interface CostBreakdownProps {
	data: ProviderResult[];
}

export default function CostBreakdown({ data }: CostBreakdownProps) {
	const successfulData = data.filter((p) => !p.error).map((p) => ({
		...p,
		cost: Number(p.cost) || 0,
		promptTokens: Number(p.promptTokens) || 0,
		completionTokens: Number(p.completionTokens) || 0,
		totalTokens: Number(p.totalTokens) || 0,
		responseTime: Number(p.responseTime) || 0,
	}));
	const totalCost = successfulData.reduce((sum, p) => sum + p.cost, 0);
	const cheapest = successfulData.reduce((min, p) =>
		p.cost < min.cost ? p : min
		, successfulData[0] || { cost: 0 });

	const m = getMessage();
	const totalTokens = successfulData.reduce((sum, p) => sum + p.totalTokens, 0);

	return (
		<Card className="border border-stone-200 dark:border-stone-800">
			<CardHeader className="p-4 pb-2">
				<CardTitle className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
					<DollarSignIcon className="h-4 w-4 text-stone-500 dark:text-stone-400" />
					{m.OPENGROUND_COST_BREAKDOWN}
				</CardTitle>
				<CardDescription className="text-xs">
					{m.OPENGROUND_COST_BREAKDOWN_DESCRIPTION}
				</CardDescription>
			</CardHeader>
			<CardContent className="p-4 pt-2">
				{/* Per-provider rows */}
				<div className="divide-y divide-stone-200 dark:divide-stone-800">
					{successfulData.map((result, index) => {
						const isCheapest = result.cost === cheapest.cost;
						return (
							<div key={index} className="py-3 first:pt-0">
								<div className="flex items-start justify-between gap-4">
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
												{result.provider}
											</p>
											{isCheapest && (
												<Badge
													variant="outline"
													className="shrink-0 border-emerald-200 bg-emerald-50 text-xs text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
												>
													{m.CHEAPEST}
												</Badge>
											)}
										</div>
										<p className="truncate text-xs text-stone-500 dark:text-stone-400">
											{result.model}
										</p>
									</div>
									<div className="text-right">
										<p
											className={`font-mono text-sm font-semibold ${
												isCheapest
													? "text-emerald-600 dark:text-emerald-400"
													: "text-stone-900 dark:text-stone-100"
											}`}
										>
											${result.cost.toFixed(6)}
										</p>
										<p className="text-xs text-stone-500 dark:text-stone-400">
											{result.responseTime.toFixed(2)}s
										</p>
									</div>
								</div>
								<div className="mt-2 grid grid-cols-3 gap-3 text-xs">
									<div>
										<p className="text-stone-500 dark:text-stone-400">{m.PROMPT}</p>
										<p className="font-mono text-stone-700 dark:text-stone-300">
											{result.promptTokens.toLocaleString()}
										</p>
									</div>
									<div>
										<p className="text-stone-500 dark:text-stone-400">{m.COMPLETION}</p>
										<p className="font-mono text-stone-700 dark:text-stone-300">
											{result.completionTokens.toLocaleString()}
										</p>
									</div>
									<div>
										<p className="text-stone-500 dark:text-stone-400">{m.TOTAL}</p>
										<p className="font-mono text-stone-700 dark:text-stone-300">
											{result.totalTokens.toLocaleString()}
										</p>
									</div>
								</div>
							</div>
						);
					})}
				</div>

				{/* Totals */}
				<div className="mt-1 flex items-center justify-between border-t border-stone-200 pt-3 dark:border-stone-800">
					<span className="text-sm font-medium text-stone-700 dark:text-stone-300">
						{m.TOTAL} {m.COST}
					</span>
					<span className="font-mono text-lg font-semibold text-primary">
						${totalCost.toFixed(6)}
					</span>
				</div>

				{/* Summary stats */}
				<div className="mt-3 grid grid-cols-1 gap-3 border-t border-stone-200 pt-3 sm:grid-cols-3 dark:border-stone-800">
					<div className="flex flex-col">
						<p className="text-xs text-stone-500 dark:text-stone-400">
							{m.AVERAGE} {m.COST}
						</p>
						<p className="font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">
							${(totalCost / successfulData.length || 0).toFixed(6)}
						</p>
					</div>
					<div className="flex flex-col">
						<p className="text-xs text-stone-500 dark:text-stone-400">
							{m.TOTAL} {m.TOKENS}
						</p>
						<p className="font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">
							{totalTokens.toLocaleString()}
						</p>
					</div>
					<div className="flex flex-col">
						<p className="text-xs text-stone-500 dark:text-stone-400">
							{m.AVERAGE} {m.COST} / 1K {m.TOKENS}
						</p>
						<p className="font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">
							${(totalCost / totalTokens * 1000 || 0).toFixed(4)}
						</p>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
