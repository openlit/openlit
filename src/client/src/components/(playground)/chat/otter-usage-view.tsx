"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { BarChart3, Coins, MessageSquare, RefreshCw, Route, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { getTimeLimitObject, TIME_RANGE_TYPE } from "@/store/filter";
import { TIME_RANGES } from "@/types/store/filter";
import getMessage from "@/constants/messages";

type UsageItem = {
	id: string;
	usageType: "chat" | "trace_analysis" | "span_analysis" | "prompt_improvement";
	location: string;
	summary: string;
	provider: string;
	model: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
	runCount: number;
	referenceId: string;
	createdAt: string;
	updatedAt: string;
};

type UsageProviderSummary = {
	provider: string;
	model: string;
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cost: number;
	runCount: number;
};

type UsageResponse = {
	totals: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		cost: number;
		runCount: number;
	};
	chatMetrics: {
		totalConversations: number;
		totalMessages: number;
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
		cost: number;
		avgTokensPerConversation: number;
		avgCostPerConversation: number;
	};
	byProviderModel: UsageProviderSummary[];
	items: UsageItem[];
};

function formatNumber(value: number) {
	return new Intl.NumberFormat("en-US").format(Math.round(value || 0));
}

function formatCost(value: number) {
	return `$${Number(value || 0).toFixed(6)}`;
}

function parseUsageDate(value?: string) {
	if (!value) return null;
	const normalized = value.includes("T") ? value : value.replace(" ", "T");
	const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized);
	const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDateTime(value?: string) {
	const date = parseUsageDate(value);
	if (!date) return "";
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "short",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: true,
		timeZoneName: "short",
	}).format(date);
}

function typeLabel(type: UsageItem["usageType"], m: ReturnType<typeof getMessage>) {
	if (type === "prompt_improvement") return m.CHAT_OTTER_USAGE_TYPE_PROMPT_IMPROVEMENT;
	if (type === "span_analysis") return m.CHAT_OTTER_USAGE_TYPE_SPAN_ANALYSIS;
	if (type === "trace_analysis") return m.CHAT_OTTER_USAGE_TYPE_TRACE_ANALYSIS;
	return m.CHAT_OTTER_USAGE_TYPE_CHAT;
}

function typeClass(type: UsageItem["usageType"]) {
	if (type === "prompt_improvement") return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
	if (type === "span_analysis") return "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
	if (type === "trace_analysis") return "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300";
	return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300";
}

function StatCard({
	icon,
	label,
	value,
}: {
	icon: ReactNode;
	label: string;
	value: string;
}) {
	return (
		<div className="rounded-md border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900/60">
			<div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
				{icon}
				{label}
			</div>
			<div className="mt-1 text-lg font-semibold text-stone-900 dark:text-stone-100">
				{value}
			</div>
		</div>
	);
}

const TIME_RANGE_TABS: { key: TIME_RANGES; label: string }[] = Object.keys(
	TIME_RANGE_TYPE
).map((key) => ({
	key: key as TIME_RANGES,
	label: TIME_RANGE_TYPE[key as TIME_RANGES],
}));

export default function OtterUsageView() {
	const m = getMessage();
	const initialTimeLimit = getTimeLimitObject("24H", "") as { start: Date; end: Date };
	const [usage, setUsage] = useState<UsageResponse | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [timeRange, setTimeRange] = useState<TIME_RANGES>("24H");
	const [selectedDate, setSelectedDate] = useState<{
		start: Date;
		end: Date;
	}>(initialTimeLimit);

	const fetchUsage = async () => {
		try {
			setIsLoading(true);
			setError(null);
			const params = new URLSearchParams({
				start: selectedDate.start.toISOString(),
				end: selectedDate.end.toISOString(),
			});
			const response = await fetch(`/api/chat/usage?${params.toString()}`);
			const result = await response.json();
			if (!response.ok) {
				throw new Error(typeof result === "string" ? result : m.CHAT_OTTER_USAGE_LOAD_FAILED);
			}
			setUsage(result.data);
		} catch (err: any) {
			setError(err?.message || m.CHAT_OTTER_USAGE_LOAD_FAILED);
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchUsage();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedDate.start, selectedDate.end]);

	const onTimeRangeChange = (value: string) => {
		const nextRange = value as TIME_RANGES;
		setTimeRange(nextRange);
		if (nextRange !== "CUSTOM") {
			setSelectedDate(getTimeLimitObject(nextRange, "") as { start: Date; end: Date });
		}
	};

	const onCustomDateChange = (start: Date, end: Date) => {
		setTimeRange("CUSTOM");
		setSelectedDate({ start, end });
	};

	const topProviders = useMemo(
		() => (usage?.byProviderModel || []).slice(0, 6),
		[usage]
	);

	return (
		<div className="flex h-full flex-col bg-white dark:bg-stone-950">
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
						<BarChart3 className="h-4 w-4 text-primary" />
						{m.CHAT_OTTER_USAGE}
					</div>
					<div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
						{m.CHAT_OTTER_USAGE_DESCRIPTION}
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
					<Tabs value={timeRange} onValueChange={onTimeRangeChange}>
						<TabsList className="h-[30px] border border-stone-200 p-0 dark:border-stone-800">
							{TIME_RANGE_TABS.map(({ key, label }) => (
								<TabsTrigger key={key} value={key} className="py-1.5 text-xs">
									{label}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
					{timeRange === "CUSTOM" && (
						<DatePickerWithRange
							selectedDate={selectedDate}
							onCustomDateChange={onCustomDateChange}
						/>
					)}
					<Button
						size="sm"
						variant="outline"
						onClick={fetchUsage}
						disabled={isLoading}
						className="shrink-0 gap-1.5"
					>
						<RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
						{m.CHAT_REFRESH}
					</Button>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-auto px-4 py-4">
				{isLoading ? (
					<div className="space-y-3">
						{[1, 2, 3].map((item) => (
							<div key={item} className="h-24 animate-pulse rounded-md bg-stone-100 dark:bg-stone-900" />
						))}
					</div>
				) : error ? (
					<div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
						{error}
					</div>
				) : !usage || (usage.items.length === 0 && usage.chatMetrics.totalConversations === 0) ? (
					<div className="rounded-md border border-stone-200 bg-stone-50 p-6 text-center dark:border-stone-800 dark:bg-stone-900/60">
						<div className="text-sm font-medium text-stone-900 dark:text-stone-100">
							{m.CHAT_OTTER_USAGE_EMPTY_TITLE}
						</div>
						<div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
							{m.CHAT_OTTER_USAGE_EMPTY_DESCRIPTION}
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="grid gap-3 md:grid-cols-4">
							<StatCard
								icon={<Zap className="h-3.5 w-3.5" />}
								label={m.CHAT_OTTER_USAGE_TOTAL_TOKENS}
								value={formatNumber(usage.totals.totalTokens)}
							/>
							<StatCard
								icon={<Coins className="h-3.5 w-3.5" />}
								label={m.CHAT_OTTER_USAGE_TOTAL_COST}
								value={formatCost(usage.totals.cost)}
							/>
							<StatCard
								icon={<MessageSquare className="h-3.5 w-3.5" />}
								label={m.CHAT_OTTER_USAGE_PROMPT_COMPLETION}
								value={`${formatNumber(usage.totals.promptTokens)} / ${formatNumber(usage.totals.completionTokens)}`}
							/>
							<StatCard
								icon={<Route className="h-3.5 w-3.5" />}
								label={m.CHAT_OTTER_USAGE_ACTIONS}
								value={formatNumber(usage.totals.runCount)}
							/>
						</div>

						<div className="grid gap-3 md:grid-cols-4">
							<StatCard
								icon={<MessageSquare className="h-3.5 w-3.5" />}
								label={m.CHAT_OTTER_USAGE_CONVERSATIONS}
								value={formatNumber(usage.chatMetrics.totalConversations)}
							/>
							<StatCard
								icon={<Sparkles className="h-3.5 w-3.5" />}
								label={m.CHAT_OTTER_USAGE_MESSAGES}
								value={formatNumber(usage.chatMetrics.totalMessages)}
							/>
							<StatCard
								icon={<Zap className="h-3.5 w-3.5" />}
								label={m.CHAT_OTTER_USAGE_AVG_TOKENS_PER_CHAT}
								value={formatNumber(usage.chatMetrics.avgTokensPerConversation)}
							/>
							<StatCard
								icon={<Coins className="h-3.5 w-3.5" />}
								label={m.CHAT_OTTER_USAGE_AVG_COST_PER_CHAT}
								value={formatCost(usage.chatMetrics.avgCostPerConversation)}
							/>
						</div>

						<div className="rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
							<div className="border-b border-stone-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
								{m.CHAT_OTTER_USAGE_PROVIDER_MODEL_SPEND}
							</div>
							<div className="divide-y divide-stone-200 dark:divide-stone-800">
								{topProviders.map((item) => (
									<div key={`${item.provider}:${item.model}`} className="grid gap-3 px-3 py-2 text-sm md:grid-cols-[1fr_120px_120px_120px]">
										<div className="min-w-0">
											<div className="truncate font-medium text-stone-900 dark:text-stone-100">
												{item.provider || m.CHAT_OTTER_USAGE_UNKNOWN} / {item.model || m.CHAT_OTTER_USAGE_UNKNOWN}
											</div>
											<div className="text-xs text-stone-500 dark:text-stone-400">
												{m.CHAT_OTTER_USAGE_ACTION_COUNT(formatNumber(item.runCount))}
											</div>
										</div>
										<div className="text-stone-600 dark:text-stone-300">{m.CHAT_OTTER_USAGE_TOKENS(formatNumber(item.totalTokens))}</div>
										<div className="text-stone-600 dark:text-stone-300">{formatCost(item.cost)}</div>
										<div className="text-stone-500 dark:text-stone-400">
											{formatNumber(item.promptTokens)} / {formatNumber(item.completionTokens)}
										</div>
									</div>
								))}
							</div>
						</div>

						<div className="rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
							<div className="border-b border-stone-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:border-stone-800 dark:text-stone-400">
								{m.CHAT_OTTER_USAGE_WHERE_USED}
							</div>
							<div className="divide-y divide-stone-200 dark:divide-stone-800">
								{usage.items.map((item) => (
									<div key={`${item.usageType}:${item.id}`} className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_180px_130px_120px]">
										<div className="min-w-0">
											<div className="flex min-w-0 items-center gap-2">
												<Badge className={typeClass(item.usageType)}>{typeLabel(item.usageType, m)}</Badge>
												<span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
													{item.location}
												</span>
											</div>
											<div className="mt-1 line-clamp-2 text-sm text-stone-600 dark:text-stone-300">
												{item.summary}
											</div>
											<div className="mt-1 truncate font-mono text-[11px] text-stone-400">
												{item.referenceId}
											</div>
										</div>
										<div className="min-w-0 text-sm">
											<div className="truncate text-stone-900 dark:text-stone-100">
												{item.provider || m.CHAT_OTTER_USAGE_UNKNOWN}
											</div>
											<div className="truncate text-xs text-stone-500 dark:text-stone-400">
												{item.model || m.CHAT_OTTER_USAGE_UNKNOWN}
											</div>
										</div>
										<div className="text-sm text-stone-600 dark:text-stone-300">
											<div>{m.CHAT_OTTER_USAGE_TOKENS(formatNumber(item.totalTokens))}</div>
											<div className="text-xs text-stone-500 dark:text-stone-400">
												{formatNumber(item.promptTokens)} / {formatNumber(item.completionTokens)}
											</div>
										</div>
										<div className="text-sm font-medium text-stone-900 dark:text-stone-100">
											{formatCost(item.cost)}
											<div className="text-xs font-normal text-stone-500 dark:text-stone-400">
												{formatLocalDateTime(item.updatedAt || item.createdAt)}
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
