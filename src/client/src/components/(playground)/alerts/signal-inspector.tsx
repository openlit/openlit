"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import getMessage from "@/constants/messages";
import { Skeleton } from "@/components/ui/skeleton";
import { useRootStore } from "@/store";
import { getCurrentProject } from "@/selectors/project";
import { alertsRequest } from "./alert-api";
import type { LiveSignal } from "@/lib/platform/realtime/signals";
import SignalDetailSheet from "./signal-detail-sheet";

export type SortOrder = "newest" | "oldest";

function signalKey(signal: LiveSignal): string {
	return `${signal.traceId}:${signal.spanId}:${signal.timestamp}`;
}

const REFRESH_MS = 5_000;

const STATUS_CLASSES: Record<string, string> = {
	ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
	error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300",
	unset: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300",
};

function latency(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function cost(value: number | null): string {
	return value === null ? "—" : `$${value.toFixed(4)}`;
}

/** Recent spans from the realtime engine, newest first, read from `url`. */
export default function SignalInspector({
	url,
	refreshToken = 0,
	order = "newest",
}: {
	url: string;
	refreshToken?: number;
	order?: SortOrder;
}) {
	const m = getMessage();
	const project = useRootStore(getCurrentProject);
	const [signals, setSignals] = useState<LiveSignal[] | null>(null);
	const [available, setAvailable] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<LiveSignal | null>(null);

	const load = useCallback(async () => {
		if (!project?.id) return;
		try {
			const res = await alertsRequest<{ available?: boolean; signals?: LiveSignal[] }>(url);
			setSignals(Array.isArray(res?.signals) ? res.signals : []);
			setAvailable(res?.available !== false);
			setError(null);
		} catch (err) {
			setError(err instanceof Error && err.message ? err.message : m.REALTIME_SIGNALS_FETCH_FAILED);
		}
	}, [project?.id, url, m.REALTIME_SIGNALS_FETCH_FAILED]);

	useEffect(() => {
		setSignals(null);
		load();
		const timer = setInterval(load, REFRESH_MS);
		return () => clearInterval(timer);
	}, [load, refreshToken]);

	const sorted = useMemo(() => {
		if (!signals) return signals;
		const direction = order === "oldest" ? 1 : -1;
		return [...signals].sort((a, b) => direction * a.timestamp.localeCompare(b.timestamp));
	}, [signals, order]);

	if (error) {
		return (
			<div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
				{error}
			</div>
		);
	}
	if (sorted === null || signals === null) {
		return (
			<div className="flex flex-col gap-2">
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-10 w-full" />
				))}
			</div>
		);
	}
	if (!available) {
		return (
			<div className="rounded-md border border-dashed border-stone-200 px-4 py-8 text-center dark:border-stone-800">
				<p className="text-sm font-medium text-stone-800 dark:text-stone-100">{m.REALTIME_SIGNALS_EMPTY_TITLE}</p>
				<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{m.REALTIME_SIGNALS_UNAVAILABLE}</p>
			</div>
		);
	}
	if (signals.length === 0) {
		return (
			<div className="rounded-md border border-dashed border-stone-200 px-4 py-8 text-center dark:border-stone-800">
				<p className="text-sm font-medium text-stone-800 dark:text-stone-100">{m.REALTIME_SIGNALS_EMPTY_TITLE}</p>
				<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{m.REALTIME_SIGNALS_EMPTY_DESCRIPTION}</p>
			</div>
		);
	}

	return (
		<div className="overflow-x-auto rounded-md border border-stone-200 dark:border-stone-800">
			<table className="w-full text-left text-xs">
				<thead className="bg-stone-50 text-stone-500 dark:bg-stone-900 dark:text-stone-400">
					<tr>
						<th className="px-3 py-2 font-medium">{m.REALTIME_SIGNALS_COLUMN_TIME}</th>
						<th className="px-3 py-2 font-medium">{m.REALTIME_SIGNALS_COLUMN_SERVICE}</th>
						<th className="px-3 py-2 font-medium">{m.REALTIME_SIGNALS_COLUMN_MODEL}</th>
						<th className="px-3 py-2 font-medium">{m.REALTIME_SIGNALS_COLUMN_STATUS}</th>
						<th className="px-3 py-2 font-medium">{m.REALTIME_SIGNALS_COLUMN_LATENCY}</th>
						<th className="px-3 py-2 font-medium">{m.REALTIME_SIGNALS_COLUMN_TOKENS}</th>
						<th className="px-3 py-2 font-medium">{m.REALTIME_SIGNALS_COLUMN_COST}</th>
						<th className="px-3 py-2 font-medium">{m.REALTIME_SIGNALS_COLUMN_ATTRIBUTES}</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-stone-200 dark:divide-stone-800">
					{sorted.map((signal) => (
						<tr
							key={signalKey(signal)}
							onClick={() => setSelected(signal)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									setSelected(signal);
								}
							}}
							tabIndex={0}
							aria-selected={selected ? signalKey(selected) === signalKey(signal) : false}
							className={`cursor-pointer text-stone-700 transition-colors hover:bg-stone-50 focus-visible:bg-stone-50 focus-visible:outline-none dark:text-stone-200 dark:hover:bg-stone-900 dark:focus-visible:bg-stone-900 ${
								selected && signalKey(selected) === signalKey(signal) ? "bg-stone-100 dark:bg-stone-900" : ""
							}`}
						>
							<td className="whitespace-nowrap px-3 py-2 text-stone-500 dark:text-stone-400">
								{new Date(signal.timestamp).toLocaleTimeString()}
							</td>
							<td className="max-w-40 truncate px-3 py-2 font-medium text-stone-900 dark:text-stone-50">
								{signal.service || "—"}
							</td>
							<td className="max-w-40 truncate px-3 py-2 font-mono text-[11px]">
								{signal.model || signal.provider || "—"}
							</td>
							<td className="px-3 py-2">
								<span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASSES[signal.status] || STATUS_CLASSES.unset}`}>
									{signal.status === "ok"
										? m.REALTIME_SIGNAL_STATUS_OK
										: signal.status === "error"
											? m.REALTIME_SIGNAL_STATUS_ERROR
											: signal.status}
								</span>
							</td>
							<td className="px-3 py-2 tabular-nums">{latency(signal.durationMs)}</td>
							<td className="px-3 py-2 tabular-nums">{Math.round(signal.totalTokens).toLocaleString()}</td>
							<td className="px-3 py-2 tabular-nums">{cost(signal.cost)}</td>
							<td className="max-w-72 truncate px-3 py-2 font-mono text-[11px] text-stone-500 dark:text-stone-400">
								{Object.entries(signal.attributes || {})
									.map(([key, value]) => `${key}=${value}`)
									.join(", ") || "—"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<SignalDetailSheet signal={selected} onClose={() => setSelected(null)} />
		</div>
	);
}
