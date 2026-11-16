"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProviderResult } from "@/lib/platform/openground-clickhouse";
import { TimerIcon } from "lucide-react";
import getMessage from "@/constants/messages";

interface PerformanceWaterfallProps {
	data: ProviderResult[];
}

export default function PerformanceWaterfall({ data }: PerformanceWaterfallProps) {
	const m = getMessage();
	const maxTime = Math.max(...data.map((p) => p.responseTime));

	// Sort by response time (fastest first)
	const sortedData = [...data].sort((a, b) => a.responseTime - b.responseTime);

	const getBarColor = (index: number, hasError: boolean) => {
		if (hasError) return "bg-rose-500/70";
		if (index === 0) return "bg-emerald-500/80"; // Fastest
		return "bg-primary/70";
	};

	const getTextColor = (index: number, hasError: boolean) => {
		if (hasError) return "text-rose-600 dark:text-rose-400";
		if (index === 0) return "text-emerald-600 dark:text-emerald-400";
		return "text-stone-600 dark:text-stone-300";
	};

	return (
		<Card className="border border-stone-200 dark:border-stone-800">
			<CardHeader className="p-4 pb-2">
				<CardTitle className="flex items-center gap-2 text-sm font-medium text-stone-700 dark:text-stone-300">
					<TimerIcon className="h-4 w-4 text-stone-500 dark:text-stone-400" />
					{m.OPENGROUND_RESPONSE_TIME_COMPARISON}
				</CardTitle>
				<CardDescription className="text-xs">
					{m.OPENGROUND_RESPONSE_TIME_COMPARISON_DESCRIPTION}
				</CardDescription>
			</CardHeader>
			<CardContent className="p-4 pt-2">
				<div className="space-y-3">
					{sortedData.map((result, index) => {
						const hasError = !!result.error;
						const percentage = hasError ? 0 : (result.responseTime / maxTime) * 100;

						return (
							<div key={index} className="space-y-1">
								<div className="flex items-center justify-between gap-2 text-sm">
									<div className="flex min-w-0 items-center gap-2">
										<span className="truncate font-medium text-stone-700 dark:text-stone-300">
											{result.provider}/{result.model}
										</span>
										{index === 0 && !hasError && (
											<Badge
												variant="outline"
												className="shrink-0 border-emerald-200 bg-emerald-50 text-xs text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
											>
												{m.FASTEST}
											</Badge>
										)}
									</div>
									<span className={`shrink-0 font-mono text-sm ${getTextColor(index, hasError)}`}>
										{hasError ? m.ERROR : `${result.responseTime.toFixed(2)}s`}
									</span>
								</div>
								<div className="relative h-6 overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900">
									<div
										className={`flex h-full items-center px-3 transition-all duration-500 ${getBarColor(index, hasError)}`}
										style={{ width: `${Math.max(percentage, 2)}%` }}
									>
										{!hasError && percentage > 20 && (
											<span className="text-xs font-medium text-white">
												{result.responseTime.toFixed(2)}s
											</span>
										)}
									</div>
									{hasError && (
										<div className="absolute inset-0 flex items-center px-3">
											<span className="truncate text-xs text-rose-600 dark:text-rose-400">
												{result.error}
											</span>
										</div>
									)}
								</div>
							</div>
						);
					})}
				</div>
				<div className="mt-4 border-t border-stone-200 pt-4 dark:border-stone-800">
					<div className="grid grid-cols-3 gap-4 text-center">
						<div>
							<p className="font-mono text-lg font-semibold text-emerald-600 dark:text-emerald-400">
								{sortedData.find((p) => !p.error)?.responseTime.toFixed(2) || "—"}s
							</p>
							<p className="text-xs text-stone-500 dark:text-stone-400">{m.FASTEST}</p>
						</div>
						<div>
							<p className="font-mono text-lg font-semibold text-stone-700 dark:text-stone-300">
								{(data.filter((p) => !p.error).reduce((sum, p) => sum + p.responseTime, 0) /
									data.filter((p) => !p.error).length || 0).toFixed(2)}s
							</p>
							<p className="text-xs text-stone-500 dark:text-stone-400">{m.AVERAGE}</p>
						</div>
						<div>
							<p className="font-mono text-lg font-semibold text-stone-700 dark:text-stone-300">
								{sortedData[sortedData.length - 1]?.error ? "—" : sortedData[sortedData.length - 1]?.responseTime.toFixed(2)}s
							</p>
							<p className="text-xs text-stone-500 dark:text-stone-400">{m.SLOWEST}</p>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
