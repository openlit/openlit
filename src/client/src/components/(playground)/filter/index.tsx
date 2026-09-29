import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { TIME_RANGE_TYPE } from "@/store/filter";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import RefreshRate from "./refresh-rate";
import { useEffect, useMemo } from "react";
import {
	useSignalCapabilities,
	type Signal,
} from "@/utils/hooks/useSignalCapabilities";
import getMessage from "@/constants/messages";
import { getCurrentProjectEnvironment } from "@/selectors/project";

const TIME_RANGE_TABS: { key: string; label: string }[] = Object.keys(
	TIME_RANGE_TYPE
).map((k: string) => ({
	key: k,
	label: TIME_RANGE_TYPE[k as keyof typeof TIME_RANGE_TYPE],
}));

const PRESET_RANGE_MS: Partial<Record<keyof typeof TIME_RANGE_TYPE, number>> = {
	"24H": 24 * 60 * 60 * 1000,
	"7D": 7 * 24 * 60 * 60 * 1000,
	"1M": 30 * 24 * 60 * 60 * 1000,
	"3M": 90 * 24 * 60 * 60 * 1000,
};

export function effectiveRangeLimit(resolved: {
	capabilities: {
		maxLookbackMs?: number;
		maxTimeRangeMs?: number;
	} | null;
} | null | undefined): number | undefined {
	const source = resolved?.capabilities;
	if (!source) return undefined;
	if (source.maxTimeRangeMs === undefined) return source.maxLookbackMs;
	return source.maxLookbackMs === undefined
		? source.maxTimeRangeMs
		: Math.min(source.maxTimeRangeMs, source.maxLookbackMs);
}

export function isPresetRangeSupported(
	preset: keyof typeof TIME_RANGE_TYPE,
	maxTimeRangeMs?: number
): boolean {
	const presetMs = PRESET_RANGE_MS[preset];
	return maxTimeRangeMs === undefined || presetMs === undefined || presetMs <= maxTimeRangeMs;
}

export function clampDateRangeToLimit(
	start: Date,
	end: Date,
	maxTimeRangeMs?: number
): { start: Date; end: Date; clamped: boolean } {
	if (
		maxTimeRangeMs === undefined ||
		end.getTime() - start.getTime() <= maxTimeRangeMs
	) {
		return { start, end, clamped: false };
	}
	return {
		start: new Date(end.getTime() - maxTimeRangeMs),
		end,
		clamped: true,
	};
}

const Filter = ({
	className = "",
	signal,
}: {
	className?: string;
	signal?: Signal;
}) => {
	const m = getMessage();
	const posthog = usePostHog();
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const environment = useRootStore(getCurrentProjectEnvironment);
	const { capabilities } = useSignalCapabilities(environment || undefined);
	const maxTimeRangeMs = useMemo(() => {
		if (signal) return effectiveRangeLimit(capabilities?.[signal]);
		const limits = Object.values(capabilities || {})
			.map(effectiveRangeLimit)
			.filter((value): value is number => Number.isFinite(value));
		return limits.length ? Math.min(...limits) : undefined;
	}, [capabilities, signal]);
	const maxTimeRangeDays = maxTimeRangeMs
		? Math.max(1, Math.floor(maxTimeRangeMs / (24 * 60 * 60 * 1000)))
		: undefined;

	useEffect(() => {
		const current = filter.timeLimit.type as keyof typeof TIME_RANGE_TYPE;
		if (isPresetRangeSupported(current, maxTimeRangeMs)) return;
		const end = new Date();
		const start = new Date(end.getTime() - maxTimeRangeMs!);
		updateFilter("timeLimit.type", TIME_RANGE_TYPE.CUSTOM, { start, end });
	}, [filter.timeLimit.type, maxTimeRangeMs, updateFilter]);

	const handleChange = (key: string) => {
		const presetMs = PRESET_RANGE_MS[key as keyof typeof TIME_RANGE_TYPE];
		if (!isPresetRangeSupported(key as keyof typeof TIME_RANGE_TYPE, maxTimeRangeMs)) {
			return;
		}
		updateFilter("timeLimit.type", key);
		posthog?.capture(CLIENT_EVENTS.TIME_FILTER_CHANGE, {
			range: key,
		});
	};

	const onCustomDateChange = (start: Date, end: Date) => {
		const bounded = clampDateRangeToLimit(start, end, maxTimeRangeMs);
		updateFilter("timeLimit.type", TIME_RANGE_TYPE.CUSTOM, {
			start: bounded.start,
			end: bounded.end,
		});
		posthog?.capture(CLIENT_EVENTS.TIME_FILTER_CHANGE, {
			range: TIME_RANGE_TYPE.CUSTOM,
		});
	};

	return (
		<div className={`flex min-w-0 shrink items-center gap-2 ${className}`}>
			<Tabs
				value={filter.timeLimit.type}
				onValueChange={handleChange}
				className="min-w-0 shrink"
			>
				<TabsList className="h-[30px] shrink-0 overflow-hidden p-0 border border-stone-200 dark:border-stone-800">
					{TIME_RANGE_TABS.map(({ label, key }) => (
						<TabsTrigger
							key={key}
							value={key}
							className="shrink-0 py-1.5 px-1.5 text-xs sm:px-2"
							disabled={
								maxTimeRangeMs !== undefined &&
								Boolean(
									PRESET_RANGE_MS[key as keyof typeof TIME_RANGE_TYPE] &&
										PRESET_RANGE_MS[key as keyof typeof TIME_RANGE_TYPE]! >
											maxTimeRangeMs
								)
							}
							title={
								maxTimeRangeDays &&
								PRESET_RANGE_MS[key as keyof typeof TIME_RANGE_TYPE] &&
								PRESET_RANGE_MS[key as keyof typeof TIME_RANGE_TYPE]! >
									maxTimeRangeMs!
									? m.DATA_SOURCE_MAX_TIME_RANGE_HINT(maxTimeRangeDays)
									: undefined
							}
						>
							{label}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
			{filter.timeLimit.type === "CUSTOM" && (
				<DatePickerWithRange
					selectedDate={filter.timeLimit}
					onCustomDateChange={onCustomDateChange}
					maxRangeDays={maxTimeRangeDays}
				/>
			)}
			<RefreshRate />
		</div>
	);
};

export default Filter;
