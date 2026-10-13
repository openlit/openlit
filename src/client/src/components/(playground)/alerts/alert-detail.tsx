"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow, ArrowLeft, ArrowUpNarrowWide, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FeatureAccess from "@/components/rbac/feature-access";
import ConfirmationModal from "@/components/common/confirmation-modal";
import getMessage from "@/constants/messages";
import { useRootStore } from "@/store";
import { getCurrentProjectEnvironment } from "@/selectors/project";
import type { ThresholdAlertView } from "@/lib/platform/alerts/threshold";
import type { RealtimeFindingView } from "@/lib/platform/realtime/types";
import { AlertsPageFrame } from "./alerts-shell";
import { AlertStatusBadge } from "./alerts-list";
import { alertsRequest } from "./alert-api";
import {
	SEVERITY_CLASSES,
	STATUS_CLASSES,
	conditionSummary,
	filtersSummary,
	formatMetricValue,
	metricLabel,
	operatorSymbol,
	relativeTime,
	windowLabel,
} from "./alert-format";
import SignalInspector, { type SortOrder } from "./signal-inspector";
import AlertDetailExtension from "./alert-detail-extension";

type Tab = "activity" | "spans" | "configuration";
type StateFilter = "all" | "firing" | "resolved";

function Tile({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
	return (
		<div className="min-w-0 bg-white px-3 py-2 dark:bg-stone-950">
			<p className="truncate text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</p>
			<div className={`mt-0.5 truncate text-sm font-semibold text-stone-950 dark:text-stone-50 ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
		</div>
	);
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[160px_minmax(0,1fr)] gap-3 border-b border-stone-100 py-2 text-xs last:border-b-0 dark:border-stone-900">
			<span className="text-stone-500 dark:text-stone-400">{label}</span>
			<span className="min-w-0 break-words text-stone-900 dark:text-stone-100">{value}</span>
		</div>
	);
}

function stateHint(m: ReturnType<typeof getMessage>, filter: StateFilter) {
	return filter === "firing"
		? m.REALTIME_FILTER_FIRING_HINT
		: filter === "resolved"
			? m.REALTIME_FILTER_RESOLVED_HINT
			: m.REALTIME_FILTER_ALL_HINT;
}

export default function AlertDetail({ alertId }: { alertId: string }) {
	const m = getMessage();
	const router = useRouter();
	const environment = useRootStore(getCurrentProjectEnvironment) || "production";
	const [alert, setAlert] = useState<ThresholdAlertView | null>(null);
	const [findings, setFindings] = useState<RealtimeFindingView[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("activity");
	const [stateFilter, setStateFilter] = useState<StateFilter>("all");
	const [order, setOrder] = useState<SortOrder>("newest");

	const load = useCallback(async () => {
		try {
			const params = new URLSearchParams({ limit: "200" });
			if (stateFilter !== "all") params.set("state", stateFilter);
			const [view, rows] = await Promise.all([
				alertsRequest<ThresholdAlertView>(`/api/alerts/threshold/${alertId}`),
				alertsRequest<RealtimeFindingView[]>(`/api/alerts/threshold/${alertId}/findings?${params}`),
			]);
			setAlert(view);
			setFindings(rows);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED);
		}
	}, [alertId, stateFilter, m.ALERT_THRESHOLD_FAILED]);

	useEffect(() => {
		load();
		const timer = setInterval(load, 15_000);
		return () => clearInterval(timer);
	}, [load, environment]);

	const sortedFindings = useMemo(() => {
		if (!findings) return findings;
		const direction = order === "oldest" ? 1 : -1;
		return [...findings].sort((a, b) => direction * a.lastSeenAt.localeCompare(b.lastSeenAt));
	}, [findings, order]);

	const toggle = async (enabled: boolean) => {
		try {
			setAlert(await alertsRequest<ThresholdAlertView>(`/api/alerts/threshold/${alertId}`, { method: "PATCH", body: { enabled } }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED);
		}
	};

	const remove = async () => {
		try {
			await alertsRequest(`/api/alerts/threshold/${alertId}`, { method: "DELETE" });
			toast.success(m.ALERTING_DELETED);
			router.push("/alerts/list");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED);
		}
	};

	const back = (
		<Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
			<Link href="/alerts/list" aria-label={m.ALERTING_BACK}>
				<ArrowLeft className="h-4 w-4" />
			</Link>
		</Button>
	);

	if (!alert) {
		return (
			<AlertsPageFrame leading={back}>
				<div className="p-4">
					{error ? (
						<div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
							{error}
						</div>
					) : (
						<Skeleton className="h-40 w-full" />
					)}
				</div>
			</AlertsPageFrame>
		);
	}

	const d = alert.definition;
	const firingNow = (findings || []).filter((f) => f.state === "firing");

	return (
		<AlertsPageFrame title={alert.name} leading={back}>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
				<div className="flex flex-wrap items-center gap-2">
					<AlertStatusBadge status={alert.status} firingCount={alert.firingCount} />
					<span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_CLASSES[alert.severity] || SEVERITY_CLASSES.info}`}>
						{alert.severity}
					</span>
					<span className="text-[11px] text-stone-500 dark:text-stone-400">{m.ALERTING_TYPE_THRESHOLD} · {alert.environment}</span>
					<div className="ml-auto flex items-center gap-2">
						<FeatureAccess access="alerts.update" requireProject hideWhenDenied>
							<label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
								<Switch checked={alert.enabled} onCheckedChange={toggle} />
								{m.ALERTING_COLUMN_ENABLED}
							</label>
							<Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" asChild>
								<Link href={`/alerts/${alert.id}/edit`}>
									<Pencil className="h-3.5 w-3.5" />
									{m.ALERTING_EDIT}
								</Link>
							</Button>
						</FeatureAccess>
						<FeatureAccess access="alerts.delete" requireProject hideWhenDenied>
							<ConfirmationModal handleYes={remove} title={m.ALERTING_DELETE_TITLE} subtitle={m.ALERTING_DELETE_DESCRIPTION} params={{}}>
								<Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-red-600 hover:text-red-700">
									<Trash2 className="h-3.5 w-3.5" />
									{m.ALERTING_DELETE}
								</Button>
							</ConfirmationModal>
						</FeatureAccess>
					</div>
				</div>
				{alert.description ? <p className="text-xs text-stone-600 dark:text-stone-300">{alert.description}</p> : null}

				<div className="grid shrink-0 gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200 dark:border-stone-800 dark:bg-stone-800 sm:grid-cols-2 lg:grid-cols-5">
					<Tile label={m.ALERTING_COLUMN_CONDITION} value={conditionSummary(d)} mono />
					<Tile label={m.ALERTING_SECTION_FILTERS} value={filtersSummary(d.match)} mono />
					<Tile label={m.ALERTING_FIRING_NOW} value={alert.firingCount} />
					<Tile label={m.ALERTING_TOTAL_OCCURRENCES} value={alert.occurrences} />
					<Tile label={m.ALERTING_COLUMN_LAST_TRIGGERED} value={relativeTime(alert.lastTriggeredAt)} />
				</div>

				<div className="flex flex-wrap items-center gap-2 border-b border-stone-200 pb-2 dark:border-stone-800">
					<Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
						<TabsList className="h-[30px] border border-stone-200 p-0 dark:border-stone-800">
							<TabsTrigger value="activity" className="px-2 py-1.5 text-xs">{m.ALERTING_TAB_ACTIVITY}</TabsTrigger>
							<TabsTrigger value="spans" className="px-2 py-1.5 text-xs">{m.ALERTING_TAB_SPANS}</TabsTrigger>
							<TabsTrigger value="configuration" className="px-2 py-1.5 text-xs">{m.ALERTING_TAB_CONFIGURATION}</TabsTrigger>
						</TabsList>
					</Tabs>
					{tab !== "configuration" ? (
						<button
							type="button"
							onClick={() => setOrder((o) => (o === "newest" ? "oldest" : "newest"))}
							className="ml-auto inline-flex h-[30px] items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2 text-xs font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300 dark:hover:bg-stone-900"
						>
							{order === "newest" ? <ArrowDownWideNarrow className="h-3.5 w-3.5" /> : <ArrowUpNarrowWide className="h-3.5 w-3.5" />}
							{order === "newest" ? m.REALTIME_SORT_NEWEST : m.REALTIME_SORT_OLDEST}
						</button>
					) : null}
					{tab === "activity" ? (
						<Tabs value={stateFilter} onValueChange={(v) => setStateFilter(v as StateFilter)}>
							<TabsList className="h-[30px] border border-stone-200 p-0 dark:border-stone-800">
								<TabsTrigger value="all" title={m.REALTIME_FILTER_ALL_HINT} className="px-2 py-1.5 text-xs">{m.REALTIME_FILTER_ALL}</TabsTrigger>
								<TabsTrigger value="firing" title={m.REALTIME_FILTER_FIRING_HINT} className="px-2 py-1.5 text-xs">{m.REALTIME_FILTER_FIRING}</TabsTrigger>
								<TabsTrigger value="resolved" title={m.REALTIME_FILTER_RESOLVED_HINT} className="px-2 py-1.5 text-xs">{m.REALTIME_FILTER_RESOLVED}</TabsTrigger>
							</TabsList>
						</Tabs>
					) : null}
				</div>

				{tab === "activity" ? (
					<div className="flex flex-col gap-2">
						<p className="text-xs text-stone-500 dark:text-stone-400">
							{m.ALERTING_ACTIVITY_HINT} {stateHint(m, stateFilter)}
						</p>
						{firingNow.length && stateFilter === "all" ? (
							<p className="text-xs font-medium text-red-600 dark:text-red-400">{m.ALERTING_FIRING_GROUPS(firingNow.length)}</p>
						) : null}
						{sortedFindings === null ? (
							<Skeleton className="h-24 w-full" />
						) : sortedFindings.length === 0 ? (
							<div className="rounded-md border border-dashed border-stone-200 px-4 py-8 text-center text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
								{m.ALERTING_NO_FINDINGS}
							</div>
						) : (
							<div className="overflow-auto rounded-md border border-stone-200 dark:border-stone-800">
								<table className="w-full text-left text-xs">
									<thead className="bg-stone-50 text-stone-500 dark:bg-stone-900 dark:text-stone-400">
										<tr>
											<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_STATE}</th>
											<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_SCOPE}</th>
											<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_VALUE}</th>
											<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_FIRST_SEEN}</th>
											<th className="px-3 py-2 font-medium">{m.REALTIME_COLUMN_LAST_SEEN}</th>
											<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_RESOLVED}</th>
											<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_OCCURRENCES}</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-stone-200 dark:divide-stone-800">
										{sortedFindings.map((f) => (
											<tr key={f.id} className="text-stone-700 dark:text-stone-200">
												<td className="px-3 py-2">
													<span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASSES[f.state] || STATUS_CLASSES.resolved}`}>
														{f.state === "firing" ? m.REALTIME_STATE_FIRING : m.REALTIME_STATE_RESOLVED}
													</span>
												</td>
												<td className="px-3 py-2 font-mono text-[11px]">
													{Object.entries(f.group).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}
												</td>
												<td className="whitespace-nowrap px-3 py-2 tabular-nums">
													{formatMetricValue(f.metric, f.value)}
													<span className="text-stone-400"> / {formatMetricValue(f.metric, f.threshold)}</span>
												</td>
												<td className="whitespace-nowrap px-3 py-2 text-stone-500 dark:text-stone-400">{new Date(f.firstSeenAt).toLocaleString()}</td>
												<td className="whitespace-nowrap px-3 py-2 text-stone-500 dark:text-stone-400">{new Date(f.lastSeenAt).toLocaleString()}</td>
												<td className="whitespace-nowrap px-3 py-2 text-stone-500 dark:text-stone-400">{f.resolvedAt ? new Date(f.resolvedAt).toLocaleString() : "—"}</td>
												<td className="px-3 py-2 tabular-nums">{f.occurrences}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				) : tab === "spans" ? (
					<div className="flex flex-col gap-2">
						<p className="text-xs text-stone-500 dark:text-stone-400">{m.ALERTING_SPANS_HINT}</p>
						<SignalInspector url={`/api/alerts/threshold/${alert.id}/signals`} order={order} />
					</div>
				) : (
					<div className="rounded-md border border-stone-200 px-3 dark:border-stone-800">
						<Row label={m.ALERTING_FIELD_METRIC} value={metricLabel(d.metric)} />
						<Row label={m.ALERTING_FIELD_OPERATOR} value={operatorSymbol(d.operator)} />
						<Row label={m.ALERTING_FIELD_THRESHOLD} value={formatMetricValue(d.metric, d.threshold)} />
						<Row label={m.ALERTING_FIELD_WINDOW} value={windowLabel(d.windowSec)} />
						<Row label={m.ALERTING_FIELD_GROUP_BY} value={d.groupBy?.length ? d.groupBy.join(", ") : "—"} />
						<Row label={m.ALERTING_FIELD_MIN_SAMPLES} value={d.minSamples ?? 1} />
						<Row label={m.ALERTING_FIELD_COOLDOWN} value={windowLabel(d.cooldownSec)} />
						<Row label={m.ALERTING_SECTION_FILTERS} value={filtersSummary(d.match)} />
						<Row label={m.ALERTING_ENGINE_RULE_ID} value={<span className="font-mono">{alert.engineRuleId}</span>} />
						<Row label={m.ALERTING_CREATED_AT} value={new Date(alert.createdAt).toLocaleString()} />
						<Row label={m.ALERTING_UPDATED_AT} value={new Date(alert.updatedAt).toLocaleString()} />
					</div>
				)}

				<AlertDetailExtension alertId={alert.id} />
			</div>
		</AlertsPageFrame>
	);
}
