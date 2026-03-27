"use client";

import { TraceHeirarchySpan } from "@/types/trace";
import { useRequest } from "../request-context";
import {
	getSpanDurationDisplay,
	getSpanCostFormatted,
	getSpanTooltipText,
} from "@/helpers/client/trace";

interface FlatSpan {
	span: TraceHeirarchySpan;
	level: number;
}

function flattenTree(
	span: TraceHeirarchySpan,
	level: number,
	result: FlatSpan[]
): void {
	result.push({ span, level });
	if (span.children) {
		for (const child of span.children) {
			flattenTree(child, level + 1, result);
		}
	}
}

function parseTimestampMs(ts?: string): number | null {
	if (!ts) return null;
	const withZ = ts.endsWith("Z") ? ts : ts + "Z";
	const ms = new Date(withZ).getTime();
	return isNaN(ms) ? null : ms;
}

function getBarColor(durationNs: number): string {
	const seconds = durationNs * 1e-9;
	if (seconds > 10) return "bg-red-500";
	if (seconds > 5) return "bg-yellow-500";
	if (seconds > 1) return "bg-blue-500";
	return "bg-green-500";
}

function formatDuration(durationNs: number): string {
	const ms = durationNs / 1e6;
	if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
	if (ms >= 1) return `${ms.toFixed(1)}ms`;
	return `${(durationNs / 1e3).toFixed(0)}µs`;
}

// Column widths as percentages of the total row
const NAME_COL_PCT = 38;
const DURATION_COL_PCT = 14;
// Bar col takes the remainder: 48%

export default function TimelineView({
	record,
}: {
	record: TraceHeirarchySpan;
}) {
	const [request, updateRequest] = useRequest();

	const flatSpans: FlatSpan[] = [];
	flattenTree(record, 0, flatSpans);

	const rootStartMs = parseTimestampMs(record.Timestamp);
	const totalDurationMs = record.Duration / 1e6;

	return (
		<div className="flex flex-col text-xs select-none">
			{/* ── Column header ── */}
			<div className="flex items-end pb-1 mb-1 border-b border-stone-200 dark:border-stone-700 gap-0">
				{/* Name column */}
				<div
					className="shrink-0 text-stone-500 dark:text-stone-400 font-medium pl-1"
					style={{ width: `${NAME_COL_PCT}%` }}
				>
					Span
				</div>

				{/* Time-axis column */}
				<div
					className="relative h-4"
					style={{ width: `${100 - NAME_COL_PCT - DURATION_COL_PCT}%` }}
				>
					{/* Left edge — 0 */}
					<span className="absolute left-0 top-0 text-stone-400 dark:text-stone-500">
						0
					</span>
					{/* Mid — 50% */}
					<span className="absolute top-0 -translate-x-1/2 text-stone-400 dark:text-stone-500" style={{ left: "50%" }}>
						{formatDuration((totalDurationMs / 2) * 1e6)}
					</span>
					{/* Right edge — total */}
					<span className="absolute right-0 top-0 text-stone-400 dark:text-stone-500">
						{formatDuration(totalDurationMs * 1e6)}
					</span>
				</div>

				{/* Duration label column header */}
				<div
					className="shrink-0 text-right pr-1 text-stone-500 dark:text-stone-400 font-medium"
					style={{ width: `${DURATION_COL_PCT}%` }}
				>
					Duration
				</div>
			</div>

			{/* ── Span rows ── */}
			<div className="flex flex-col gap-3">
				{flatSpans.map(({ span, level }) => {
					const isSelected = request?.spanId === span.SpanId;
					const spanStartMs = parseTimestampMs(span.Timestamp);
					const spanDurationMs = span.Duration / 1e6;

					const durationDisplay = getSpanDurationDisplay(span);
					const costDisplay = getSpanCostFormatted(span, 10);
					const tooltipText = getSpanTooltipText(span);

					let leftPct = 0;
					let widthPct =
						totalDurationMs > 0
							? (spanDurationMs / totalDurationMs) * 100
							: 100;

					if (
						rootStartMs !== null &&
						spanStartMs !== null &&
						totalDurationMs > 0
					) {
						leftPct =
							((spanStartMs - rootStartMs) / totalDurationMs) * 100;
					}

					// Clamp so nothing goes out of bounds
					leftPct = Math.max(0, Math.min(leftPct, 99));
					widthPct = Math.max(1, Math.min(widthPct, 100 - leftPct));

					return (
						<div
							key={span.SpanId}
							className={`flex flex-col rounded cursor-pointer transition-colors ${
								isSelected
									? "bg-primary/10 dark:bg-primary/10"
									: "hover:bg-stone-200/60 dark:hover:bg-stone-800/60"
							}`}
							onClick={() => updateRequest({ spanId: span.SpanId })}
							title={tooltipText}
						>
							{/* Main row: name + bar + duration */}
							<div className="flex items-center h-6">
								{/* ── Name column ── */}
								<div
									className="shrink-0 h-full flex items-center overflow-hidden pr-2"
									style={{
										width: `${NAME_COL_PCT}%`,
										paddingLeft: `${level * 10 + 4}px`,
									}}
								>
									<span
										className={`truncate text-[11px] leading-none ${
											isSelected
												? "text-primary font-medium"
												: "text-stone-700 dark:text-stone-300"
										}`}
									>
										{span.SpanName}
									</span>
								</div>

								{/* ── Bar column ── */}
								<div
									className="relative h-full flex items-center"
									style={{
										width: `${100 - NAME_COL_PCT - DURATION_COL_PCT}%`,
									}}
								>
									{/* Background track */}
									<div className="absolute inset-x-0 h-px bg-stone-200 dark:bg-stone-700 top-1/2 -translate-y-1/2" />
									{/* Span bar */}
									<div
										className={`absolute h-[10px] rounded-sm ${getBarColor(span.Duration)} ${
											isSelected
												? "ring-1 ring-primary ring-offset-0"
												: "opacity-80"
										}`}
										style={{
											left: `${leftPct}%`,
											width: `${widthPct}%`,
										}}
									/>
								</div>

								{/* ── Duration column ── */}
								<div
									className={`shrink-0 text-right pr-1 text-[10px] tabular-nums ${
										isSelected
											? "text-primary font-medium"
											: "text-stone-500 dark:text-stone-400"
									}`}
									style={{ width: `${DURATION_COL_PCT}%` }}
								>
									{durationDisplay}
								</div>
							</div>

							{/* Cost row below the bar */}
							{costDisplay && (
								<div className="flex items-center h-4">
									{/* Empty name column spacer */}
									<div className="shrink-0" style={{ width: `${NAME_COL_PCT}%` }} />
									{/* Cost aligned under the bar */}
									<div
										className="relative"
										style={{
											width: `${100 - NAME_COL_PCT - DURATION_COL_PCT}%`,
											paddingLeft: `${leftPct}%`,
										}}
									>
										<span className={`text-[9px] tabular-nums ${
											isSelected
												? "text-primary/80"
												: "text-stone-400 dark:text-stone-500"
										}`}>
											{costDisplay}
										</span>
									</div>
									<div className="shrink-0" style={{ width: `${DURATION_COL_PCT}%` }} />
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
