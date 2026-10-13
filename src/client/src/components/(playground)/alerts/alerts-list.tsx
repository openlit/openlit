"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import FeatureAccess from "@/components/rbac/feature-access";
import ConfirmationModal from "@/components/common/confirmation-modal";
import getMessage from "@/constants/messages";
import { useRootStore } from "@/store";
import { getCurrentProject, getCurrentProjectEnvironment } from "@/selectors/project";
import type { ThresholdAlertView } from "@/lib/platform/alerts/threshold";
import { AlertsPageFrame } from "./alerts-shell";
import { alertsRequest } from "./alert-api";
import { SEVERITY_CLASSES, STATUS_CLASSES, conditionSummary, filtersSummary, relativeTime } from "./alert-format";

export function AlertStatusBadge({ status, firingCount }: { status: string; firingCount?: number }) {
	const m = getMessage();
	const label =
		status === "firing"
			? firingCount && firingCount > 1
				? m.ALERTING_STATUS_FIRING_N(firingCount)
				: m.ALERTING_STATUS_FIRING
			: status === "disabled"
				? m.ALERTING_STATUS_DISABLED
				: m.ALERTING_STATUS_OK;
	return (
		<span className={`inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASSES[status] || STATUS_CLASSES.ok}`}>
			{label}
		</span>
	);
}

export default function AlertsList() {
	const m = getMessage();
	const router = useRouter();
	const project = useRootStore(getCurrentProject);
	const environment = useRootStore(getCurrentProjectEnvironment) || "production";
	const [alerts, setAlerts] = useState<ThresholdAlertView[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!project?.id) return;
		try {
			setAlerts(await alertsRequest<ThresholdAlertView[]>("/api/alerts/threshold"));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED);
			setAlerts([]);
		}
	}, [project?.id, m.ALERT_THRESHOLD_FAILED]);

	useEffect(() => {
		setAlerts(null);
		load();
		const timer = setInterval(load, 15_000);
		return () => clearInterval(timer);
	}, [load, environment]);

	const toggle = async (alert: ThresholdAlertView, enabled: boolean) => {
		try {
			await alertsRequest(`/api/alerts/threshold/${alert.id}`, { method: "PATCH", body: { enabled } });
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED);
		}
	};

	const remove = async ({ id }: { id: string }) => {
		try {
			await alertsRequest(`/api/alerts/threshold/${id}`, { method: "DELETE" });
			toast.success(m.ALERTING_DELETED);
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED);
		}
	};

	return (
		<AlertsPageFrame>
			<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
				<div className="flex flex-wrap items-center gap-2">
					<p className="min-w-0 flex-1 text-xs text-stone-500 dark:text-stone-400">{m.ALERTING_LIST_HINT}</p>
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

				{alerts === null ? (
					<div className="flex flex-col gap-2">
						{[0, 1, 2].map((i) => (
							<Skeleton key={i} className="h-12 w-full" />
						))}
					</div>
				) : alerts.length === 0 ? (
					<div className="rounded-md border border-dashed border-stone-300 px-4 py-10 text-center dark:border-stone-700">
						<p className="text-sm font-medium text-stone-800 dark:text-stone-100">{m.ALERTING_EMPTY_TITLE}</p>
						<p className="mx-auto mt-1 max-w-md text-xs text-stone-500 dark:text-stone-400">{m.ALERTING_EMPTY_DESCRIPTION}</p>
					</div>
				) : (
					<div className="min-h-0 overflow-auto rounded-md border border-stone-200 dark:border-stone-800">
						<table className="w-full text-left text-xs">
							<thead className="sticky top-0 z-10 bg-stone-50 text-stone-500 dark:bg-stone-900 dark:text-stone-400">
								<tr>
									<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_STATUS}</th>
									<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_ALERT}</th>
									<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_CONDITION}</th>
									<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_SEVERITY}</th>
									<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_LAST_TRIGGERED}</th>
									<th className="px-3 py-2 font-medium">{m.ALERTING_COLUMN_ENABLED}</th>
									<th className="px-3 py-2" />
								</tr>
							</thead>
							<tbody className="divide-y divide-stone-200 dark:divide-stone-800">
								{alerts.map((alert) => (
									<tr
										key={alert.id}
										onClick={() => router.push(`/alerts/${alert.id}`)}
										className="cursor-pointer text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-900"
									>
										<td className="px-3 py-2">
											<AlertStatusBadge status={alert.status} firingCount={alert.firingCount} />
										</td>
										<td className="max-w-64 px-3 py-2">
											<p className="truncate font-medium text-stone-900 dark:text-stone-50">{alert.name}</p>
											<p className="truncate text-[11px] text-stone-500 dark:text-stone-400">{m.ALERTING_TYPE_THRESHOLD}</p>
										</td>
										<td className="max-w-80 px-3 py-2">
											<p className="truncate font-mono text-[11px]">{conditionSummary(alert.definition)}</p>
											<p className="truncate text-[11px] text-stone-500 dark:text-stone-400">{filtersSummary(alert.definition.match)}</p>
										</td>
										<td className="px-3 py-2">
											<span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_CLASSES[alert.severity] || SEVERITY_CLASSES.info}`}>
												{alert.severity}
											</span>
										</td>
										<td className="whitespace-nowrap px-3 py-2 text-stone-500 dark:text-stone-400">
											{relativeTime(alert.lastTriggeredAt)}
										</td>
										<td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
											<FeatureAccess access="alerts.update" requireProject hideWhenDenied>
												<Switch
													checked={alert.enabled}
													onCheckedChange={(checked) => toggle(alert, checked)}
													aria-label={m.ALERTING_COLUMN_ENABLED}
												/>
											</FeatureAccess>
										</td>
										<td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
											<div className="flex items-center justify-end gap-1">
												<FeatureAccess access="alerts.update" requireProject hideWhenDenied>
													<Button variant="ghost" size="icon" className="h-7 w-7" asChild>
														<Link href={`/alerts/${alert.id}/edit`} aria-label={m.ALERTING_EDIT}>
															<Pencil className="h-3.5 w-3.5" />
														</Link>
													</Button>
												</FeatureAccess>
												<FeatureAccess access="alerts.delete" requireProject hideWhenDenied>
													<ConfirmationModal
														handleYes={remove}
														title={m.ALERTING_DELETE_TITLE}
														subtitle={m.ALERTING_DELETE_DESCRIPTION}
														params={{ id: alert.id }}
													>
														<Trash2 className="h-3.5 w-3.5 cursor-pointer text-stone-400 hover:text-red-500" />
													</ConfirmationModal>
												</FeatureAccess>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</AlertsPageFrame>
	);
}
