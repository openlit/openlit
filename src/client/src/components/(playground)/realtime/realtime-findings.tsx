"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, Radio } from "lucide-react";
import getMessage from "@/constants/messages";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import RealtimeRulesExtension from "@/components/(playground)/realtime/realtime-rules-extension";
import SignalInspector from "@/components/(playground)/realtime/signal-inspector";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRootStore } from "@/store";
import { getCurrentProject, getCurrentProjectEnvironment } from "@/selectors/project";
import { getData } from "@/utils/api";
import type { RealtimeFindingView } from "@/lib/platform/realtime/types";

type StateFilter = "firing" | "resolved" | "all";
type PageView = "findings" | "inspector";

const REFRESH_MS = 15_000;

const HEADER_TONE =
	"border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-300";

const PILL_ACTIVE =
	"border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200";
const PILL_IDLE =
	"border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800";

const SEVERITY_CLASSES: Record<string, string> = {
	critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300",
	warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
	info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300",
};

function formatMetric(metric: string | null, value: number): string {
	switch (metric) {
		case "error_rate":
			return `${(value * 100).toFixed(1)}%`;
		case "p95_latency_ms":
		case "avg_latency_ms":
			return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
		case "cost":
			return `$${value.toFixed(4)}`;
		case "total_tokens":
		case "count":
		case "error_count":
			return Math.round(value).toLocaleString();
		default:
			return String(value);
	}
}

function formatGroup(group: Record<string, string>): string {
	const entries = Object.entries(group);
	return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(" · ") : "—";
}

function PillTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${active ? PILL_ACTIVE : PILL_IDLE}`}
		>
			<span>{label}</span>
		</button>
	);
}

export default function RealtimeFindings() {
	const m = getMessage();
	const searchParams = useSearchParams();
	const project = useRootStore(getCurrentProject);
	const environment = useRootStore(getCurrentProjectEnvironment) || "production";
	const requestedView = searchParams.get("view") === "inspector" ? "inspector" : "findings";
	const [view, setView] = useState<PageView>(requestedView);
	const [refreshToken, setRefreshToken] = useState(0);
	const [stateFilter, setStateFilter] = useState<StateFilter>("firing");
	const [findings, setFindings] = useState<RealtimeFindingView[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const load = useCallback(async () => {
		if (!project?.id) return;
		setLoading(true);
		try {
			const params = new URLSearchParams({ environment });
			if (stateFilter !== "all") params.set("state", stateFilter);
			const res = await getData({ url: `/api/realtime/findings?${params}`, method: "GET" });
			setFindings(Array.isArray(res?.findings) ? res.findings : []);
			setError(null);
		} catch (err) {
			setError(err instanceof Error && err.message ? err.message : m.REALTIME_FINDINGS_FETCH_FAILED);
		} finally {
			setLoading(false);
		}
	}, [project?.id, environment, stateFilter, m.REALTIME_FINDINGS_FETCH_FAILED]);

	useEffect(() => {
		setView(requestedView);
	}, [requestedView]);

	useEffect(() => {
		setFindings(null);
		load();
		const timer = setInterval(load, REFRESH_MS);
		return () => clearInterval(timer);
	}, [load, refreshToken]);

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<FeaturePageHeader
				eyebrow={m.SIDEBAR_MONITOR}
				title={m.REALTIME_TITLE}
				icon={<Radio className="h-4 w-4" />}
				tone={HEADER_TONE}
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<PillTab active={view === "findings"} label={m.REALTIME_VIEW_FINDINGS} onClick={() => setView("findings")} />
						<PillTab active={view === "inspector"} label={m.REALTIME_VIEW_INSPECTOR} onClick={() => setView("inspector")} />
						<button
							type="button"
							onClick={() => {
								setRefreshToken((n) => n + 1);
								if (view === "findings") load();
							}}
							disabled={loading || !project?.id}
							aria-label={m.REALTIME_REFRESH}
							className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-stone-600 transition hover:bg-stone-100 disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
						>
							<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
						</button>
					</div>
				}
			/>

			{view === "findings" ? (
				<div className="flex items-center justify-end border-b border-stone-200 px-4 py-2 dark:border-stone-800">
					<Tabs
						value={stateFilter}
						onValueChange={(value) => setStateFilter(value as StateFilter)}
						className="min-w-0 shrink"
					>
						<TabsList className="h-[30px] shrink-0 overflow-hidden border border-stone-200 p-0 dark:border-stone-800">
							<TabsTrigger value="firing" className="shrink-0 px-1.5 py-1.5 text-xs sm:px-2">
								{m.REALTIME_FILTER_FIRING}
							</TabsTrigger>
							<TabsTrigger value="resolved" className="shrink-0 px-1.5 py-1.5 text-xs sm:px-2">
								{m.REALTIME_FILTER_RESOLVED}
							</TabsTrigger>
							<TabsTrigger value="all" className="shrink-0 px-1.5 py-1.5 text-xs sm:px-2">
								{m.REALTIME_FILTER_ALL}
							</TabsTrigger>
						</TabsList>
					</Tabs>
				</div>
			) : null}

			<section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
				{!project?.id ? (
					<p className="text-xs text-stone-500 dark:text-stone-400">{m.REALTIME_FINDING_NO_PROJECT}</p>
				) : view === "inspector" ? (
					<SignalInspector environment={environment} refreshToken={refreshToken} />
				) : error ? (
					<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
						{error}
					</div>
				) : findings === null ? (
					<div className="flex flex-col gap-2">
						{[0, 1, 2].map((i) => (
							<Skeleton key={i} className="h-10 w-full" />
						))}
					</div>
				) : findings.length === 0 ? (
					<div className="rounded-md border border-dashed border-stone-200 px-4 py-8 text-center dark:border-stone-800">
						<p className="text-sm font-medium text-stone-800 dark:text-stone-100">{m.REALTIME_EMPTY_TITLE}</p>
						<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{m.REALTIME_EMPTY_DESCRIPTION}</p>
					</div>
				) : (
					<div className="min-h-0 overflow-auto rounded-md border border-stone-200 dark:border-stone-800">
						<table className="w-full text-left text-xs">
							<thead className="sticky top-0 bg-stone-50 text-stone-500 dark:bg-stone-900 dark:text-stone-400">
								<tr>
									<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_SEVERITY}</th>
									<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_RULE}</th>
									<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_SCOPE}</th>
									<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_VALUE}</th>
									<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_STATE}</th>
									<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_LAST_SEEN}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-stone-200 dark:divide-stone-800">
								{findings.map((f) => (
									<tr key={f.id} className="text-stone-700 dark:text-stone-200">
										<td className="px-3 py-2">
											<span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_CLASSES[f.severity] || SEVERITY_CLASSES.info}`}>
												{f.severity}
											</span>
										</td>
										<td className="px-3 py-2">
											<div className="font-medium text-stone-900 dark:text-stone-50">{f.ruleName}</div>
											<div className="text-[11px] text-stone-500 dark:text-stone-400">{f.kind}</div>
										</td>
										<td className="px-3 py-2 font-mono text-[11px]">{formatGroup(f.group)}</td>
										<td className="px-3 py-2 tabular-nums">
											{formatMetric(f.metric, f.value)}
											{f.mode === "window" ? (
												<span className="text-stone-400 dark:text-stone-500"> / {formatMetric(f.metric, f.threshold)}</span>
											) : null}
										</td>
										<td className="px-3 py-2">
											{f.state === "firing" ? m.REALTIME_STATE_FIRING : m.REALTIME_STATE_RESOLVED}
											{f.occurrences > 1 ? (
												<span className="text-stone-400 dark:text-stone-500"> ×{f.occurrences}</span>
											) : null}
										</td>
										<td className="px-3 py-2 text-stone-500 dark:text-stone-400">
											{new Date(f.lastSeenAt).toLocaleString()}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{project?.id && view === "findings" ? (
					<RealtimeRulesExtension projectId={project.id} environment={environment} />
				) : null}
			</section>
		</div>
	);
}
