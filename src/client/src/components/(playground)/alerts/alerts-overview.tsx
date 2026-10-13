"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import FeatureAccess from "@/components/rbac/feature-access";
import getMessage from "@/constants/messages";
import { useRootStore } from "@/store";
import { getCurrentProject, getCurrentProjectEnvironment } from "@/selectors/project";
import type { ThresholdAlertOverview } from "@/lib/platform/alerts/threshold";
import { AlertsPageFrame } from "./alerts-shell";
import { alertsRequest } from "./alert-api";
import { SEVERITY_CLASSES, STATUS_CLASSES, formatMetricValue, relativeTime } from "./alert-format";
import AlertsOverviewExtension from "./alerts-overview-extension";

const REFRESH_MS = 15_000;

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
	return (
		<div className="bg-white px-3 py-2 dark:bg-stone-950">
			<p className="truncate text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</p>
			<p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone || "text-stone-950 dark:text-stone-50"}`}>{value}</p>
		</div>
	);
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
	return (
		<section className="flex min-h-0 flex-col rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
			<div className="flex items-center justify-between gap-2 border-b border-stone-200 px-3 py-2 dark:border-stone-800">
				<h2 className="text-xs font-semibold text-stone-900 dark:text-stone-50">{title}</h2>
				{action}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
		</section>
	);
}

export default function AlertsOverview() {
	const m = getMessage();
	const project = useRootStore(getCurrentProject);
	const environment = useRootStore(getCurrentProjectEnvironment) || "production";
	const [data, setData] = useState<ThresholdAlertOverview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const load = useCallback(async () => {
		if (!project?.id) return;
		setLoading(true);
		try {
			setData(await alertsRequest<ThresholdAlertOverview>("/api/alerts/threshold/overview"));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED);
		} finally {
			setLoading(false);
		}
	}, [project?.id, m.ALERT_THRESHOLD_FAILED]);

	useEffect(() => {
		setData(null);
		load();
		const timer = setInterval(load, REFRESH_MS);
		return () => clearInterval(timer);
	}, [load, environment]);

	const severities = ["critical", "warning", "info"];
	const firingTotal = data ? severities.reduce((sum, s) => sum + (data.firingBySeverity[s] || 0), 0) : 0;

	return (
		<AlertsPageFrame>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
				<div className="flex flex-wrap items-center gap-2">
					<p className="min-w-0 flex-1 text-xs text-stone-500 dark:text-stone-400">{m.ALERTING_OVERVIEW_HINT}</p>
					<Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={load} disabled={loading} aria-label={m.ALERTING_REFRESH}>
						<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
					</Button>
					<FeatureAccess access="alerts.create" requireProject hideWhenDenied>
						<Button size="sm" asChild className="h-8">
							<Link href="/alerts/new">
								<Plus className="mr-1.5 h-4 w-4" />
								{m.ALERTING_NEW}
							</Link>
						</Button>
					</FeatureAccess>
				</div>

				{error ? (
					<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
						{error}
					</div>
				) : null}

				{!data ? (
					<div className="grid gap-2 sm:grid-cols-5">
						{[0, 1, 2, 3, 4].map((i) => (
							<Skeleton key={i} className="h-14" />
						))}
					</div>
				) : (
					<>
						<div className="grid shrink-0 gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200 dark:border-stone-800 dark:bg-stone-800 sm:grid-cols-3 lg:grid-cols-5">
							<Tile
								label={m.ALERTING_TILE_FIRING_ALERTS}
								value={data.firingAlerts}
								tone={data.firingAlerts ? "text-red-600 dark:text-red-400" : undefined}
							/>
							<Tile label={m.ALERTING_TILE_FIRING_FINDINGS} value={data.firingFindings} />
							<Tile label={m.ALERTING_TILE_RESOLVED_24H} value={data.resolvedLast24h} />
							<Tile label={m.ALERTING_TILE_ENABLED} value={data.enabled} />
							<Tile label={m.ALERTING_TILE_TOTAL} value={data.alerts} />
						</div>

						<div className="rounded-md border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-950">
							<div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400">
								<span className="font-medium uppercase tracking-wide">{m.ALERTING_FIRING_BY_SEVERITY}</span>
								<span>{firingTotal ? m.ALERTING_N_FIRING(firingTotal) : m.ALERTING_NOTHING_FIRING}</span>
							</div>
							<div className="mt-2 flex h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
								{firingTotal
									? severities.map((severity) =>
											data.firingBySeverity[severity] ? (
												<div
													key={severity}
													className={severity === "critical" ? "bg-red-500" : severity === "warning" ? "bg-amber-500" : "bg-sky-500"}
													style={{ width: `${(data.firingBySeverity[severity] / firingTotal) * 100}%` }}
													title={`${severity}: ${data.firingBySeverity[severity]}`}
												/>
											) : null
										)
									: null}
							</div>
							<div className="mt-2 flex flex-wrap gap-2">
								{severities.map((severity) => (
									<span
										key={severity}
										className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_CLASSES[severity]}`}
									>
										{severity} · {data.firingBySeverity[severity] || 0}
									</span>
								))}
							</div>
						</div>

						{data.alerts === 0 ? (
							<div className="rounded-md border border-dashed border-stone-300 px-4 py-10 text-center dark:border-stone-700">
								<BellRing className="mx-auto h-5 w-5 text-stone-400" />
								<p className="mt-2 text-sm font-medium text-stone-800 dark:text-stone-100">{m.ALERTING_EMPTY_TITLE}</p>
								<p className="mx-auto mt-1 max-w-md text-xs text-stone-500 dark:text-stone-400">{m.ALERTING_EMPTY_DESCRIPTION}</p>
							</div>
						) : (
							<div className="grid min-h-[280px] gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
								<Panel title={m.ALERTING_RECENT_ACTIVITY}>
									{data.recent.length === 0 ? (
										<p className="px-3 py-4 text-xs text-stone-500 dark:text-stone-400">{m.ALERTING_NO_ACTIVITY}</p>
									) : (
										<ul className="divide-y divide-stone-100 dark:divide-stone-900">
											{data.recent.map((finding) => {
												const content = (
													<div className="flex items-center gap-3 px-3 py-2 text-xs">
														<span className={`inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLASSES[finding.state] || STATUS_CLASSES.resolved}`}>
															{finding.state === "firing" ? m.REALTIME_STATE_FIRING : m.REALTIME_STATE_RESOLVED}
														</span>
														<div className="min-w-0 flex-1">
															<p className="truncate font-medium text-stone-900 dark:text-stone-50">{finding.ruleName}</p>
															<p className="truncate font-mono text-[11px] text-stone-500 dark:text-stone-400">
																{Object.entries(finding.group).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}
															</p>
														</div>
														<span className="shrink-0 tabular-nums text-stone-700 dark:text-stone-300">
															{formatMetricValue(finding.metric, finding.value)}
														</span>
														<span className="w-20 shrink-0 text-right text-[11px] text-stone-500 dark:text-stone-400">
															{relativeTime(finding.lastSeenAt)}
														</span>
													</div>
												);
												return (
													<li key={finding.id}>
														{finding.alertId ? (
															<Link href={`/alerts/${finding.alertId}`} className="block hover:bg-stone-50 dark:hover:bg-stone-900">
																{content}
															</Link>
														) : (
															content
														)}
													</li>
												);
											})}
										</ul>
									)}
								</Panel>
								<Panel
									title={m.ALERTING_NOISIEST}
									action={
										<Link href="/alerts/list" className="text-[11px] font-medium text-stone-600 hover:underline dark:text-stone-300">
											{m.ALERTING_VIEW_ALL}
										</Link>
									}
								>
									{data.noisiest.length === 0 ? (
										<p className="px-3 py-4 text-xs text-stone-500 dark:text-stone-400">{m.ALERTING_NO_ACTIVITY}</p>
									) : (
										<ul className="divide-y divide-stone-100 dark:divide-stone-900">
											{data.noisiest.map((alert) => (
												<li key={alert.alertId}>
													<Link href={`/alerts/${alert.alertId}`} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-stone-50 dark:hover:bg-stone-900">
														<span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_CLASSES[alert.severity] || SEVERITY_CLASSES.info}`}>
															{alert.severity}
														</span>
														<span className="min-w-0 flex-1 truncate font-medium text-stone-900 dark:text-stone-50">{alert.name}</span>
														<span className="tabular-nums text-stone-500 dark:text-stone-400">{m.ALERTING_TIMES(alert.occurrences)}</span>
													</Link>
												</li>
											))}
										</ul>
									)}
								</Panel>
							</div>
						)}
						<AlertsOverviewExtension />
					</>
				)}
			</div>
		</AlertsPageFrame>
	);
}
