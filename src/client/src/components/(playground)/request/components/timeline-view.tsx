"use client";

/**
 * Timeline View — Waterfall/Gantt visualization of span execution.
 *
 * ## Sequencing logic
 *
 * The row order follows a depth-first pre-order traversal of the hierarchy
 * tree, with siblings sorted by their start timestamp (Timestamp field).
 * This means a parent span always appears before its children, and siblings
 * appear in the order they actually started.
 *
 * The horizontal bar position is computed relative to the *trace time window*,
 * which spans from the earliest start timestamp across all spans to the latest
 * end timestamp (start + duration). Using the full trace window — rather than
 * just the root span's self-duration — ensures that bars for late-finishing
 * children or clock-skewed spans remain within bounds.
 *
 *   leftPct  = (spanStartMs - traceStartMs) / traceWindowMs * 100
 *   widthPct = spanDurationMs / traceWindowMs * 100
 *
 * Both are clamped to [0, 100] to prevent overflow.
 */

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

/**
 * Depth-first pre-order traversal. Siblings are already sorted by Timestamp
 * in buildHierarchy (server-side), so iteration order == chronological order.
 */
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

/**
 * Compute the trace time window (earliest start → latest end) across ALL spans.
 * This is more accurate than using the root span's duration alone, because:
 * - A child may start slightly before the root's recorded Timestamp (clock skew)
 * - A child may finish after the root's Duration (async/detached spans)
 */
function computeTraceWindow(flatSpans: FlatSpan[]): {
	startMs: number;
	endMs: number;
	windowMs: number;
} {
	let startMs = Infinity;
	let endMs = -Infinity;

	for (const { span } of flatSpans) {
		const t = parseTimestampMs(span.Timestamp);
		if (t === null) continue;
		const durationMs = span.Duration / 1e6;
		if (t < startMs) startMs = t;
		if (t + durationMs > endMs) endMs = t + durationMs;
	}

	if (!isFinite(startMs) || !isFinite(endMs)) {
		return { startMs: 0, endMs: 1, windowMs: 1 };
	}

	const windowMs = Math.max(endMs - startMs, 0.001); // avoid zero-division
	return { startMs, endMs, windowMs };
}

const NAME_COL_PCT = 32;
const STATS_COL_PCT = 18;

export default function TimelineView({
	record,
}: {
	record: TraceHeirarchySpan;
}) {
	const [request, updateRequest] = useRequest();

	const flatSpans: FlatSpan[] = [];
	flattenTree(record, 0, flatSpans);

	const { startMs: traceStartMs, windowMs: traceWindowMs } =
		computeTraceWindow(flatSpans);

	return (
		<div className="flex flex-col text-xs select-none">
			{/* ── Column header ── */}
			<div className="flex items-end pb-1 mb-1 border-b border-stone-200 dark:border-stone-700 gap-0">
				<div
					className="shrink-0 text-stone-500 dark:text-stone-400 font-medium pl-1"
					style={{ width: `${NAME_COL_PCT}%` }}
				>
					Span
				</div>

				{/* Time-axis ticks */}
				<div
					className="relative h-4"
					style={{ width: `${100 - NAME_COL_PCT - STATS_COL_PCT}%` }}
				>
					<span className="absolute left-0 top-0 text-stone-400 dark:text-stone-500">
						0
					</span>
					<span
						className="absolute top-0 -translate-x-1/2 text-stone-400 dark:text-stone-500"
						style={{ left: "50%" }}
					>
						{formatDuration((traceWindowMs / 2) * 1e6)}
					</span>
					<span className="absolute right-0 top-0 text-stone-400 dark:text-stone-500">
						{formatDuration(traceWindowMs * 1e6)}
					</span>
				</div>

				<div
					className="shrink-0 text-right pr-1.5 pl-1.5 text-stone-500 dark:text-stone-400 font-medium"
					style={{ width: `${STATS_COL_PCT}%` }}
				>
					<div className="leading-none text-[10px]">Duration</div>
					<div className="leading-none text-[9px] text-stone-400 dark:text-stone-500 mt-0.5">
						Cost
					</div>
				</div>
			</div>

			{/* ── Span rows ── */}
			<div className="flex flex-col gap-1.5">
				{flatSpans.map(({ span, level }) => {
					const isSelected = request?.spanId === span.SpanId;
					const spanStartMs = parseTimestampMs(span.Timestamp);
					const spanDurationMs = span.Duration / 1e6;

					const durationDisplay = getSpanDurationDisplay(span);
					const costDisplay = getSpanCostFormatted(span, 6);
					const tooltipText = getSpanTooltipText(span);

					// Bar position relative to the full trace time window
					let leftPct = 0;
					let widthPct = (spanDurationMs / traceWindowMs) * 100;

					if (spanStartMs !== null) {
						leftPct =
							((spanStartMs - traceStartMs) / traceWindowMs) * 100;
					}

					// Clamp
					leftPct = Math.max(0, Math.min(leftPct, 99));
					widthPct = Math.max(0.5, Math.min(widthPct, 100 - leftPct));

					return (
						<div
							key={span.SpanId}
							className={`flex items-center rounded cursor-pointer transition-colors py-1 ${
								isSelected
									? "bg-primary/10 dark:bg-primary/10"
									: "hover:bg-stone-200/60 dark:hover:bg-stone-800/60"
							}`}
							onClick={() =>
								updateRequest({ spanId: span.SpanId })
							}
							title={tooltipText}
						>
							{/* Name */}
							<div
								className="shrink-0 flex items-center overflow-hidden pr-2"
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

							{/* Bar */}
							<div
								className="relative h-[10px] overflow-hidden"
								style={{
									width: `${100 - NAME_COL_PCT - STATS_COL_PCT}%`,
								}}
							>
								<div className="absolute inset-x-0 h-px bg-stone-200 dark:bg-stone-700 top-1/2 -translate-y-1/2" />
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

							{/* Duration + Cost */}
							<div
								className="shrink-0 text-right pr-1.5 pl-1.5 flex flex-col items-end justify-center overflow-hidden"
								style={{ width: `${STATS_COL_PCT}%` }}
							>
								<span
									className={`text-[10px] tabular-nums leading-tight truncate max-w-full ${
										isSelected
											? "text-primary font-medium"
											: "text-stone-500 dark:text-stone-400"
									}`}
								>
									{durationDisplay}
								</span>
								{costDisplay && (
									<span
										className={`text-[9px] tabular-nums leading-tight truncate max-w-full ${
											isSelected
												? "text-primary/80"
												: "text-stone-400 dark:text-stone-500"
										}`}
									>
										{costDisplay}
									</span>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
