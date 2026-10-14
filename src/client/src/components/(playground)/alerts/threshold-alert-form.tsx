"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import getMessage from "@/constants/messages";
import { REALTIME_ATTRIBUTE_FIELDS } from "@/lib/platform/realtime/attributes";
import { REALTIME_SEVERITIES, type RealtimeSeverity } from "@/lib/platform/realtime/types";
import {
	REALTIME_CONDITION_OPS,
	REALTIME_NUMERIC_FIELDS,
	REALTIME_RULE_LIMITS,
	REALTIME_RULE_METRICS,
	REALTIME_RULE_OPERATORS,
	REALTIME_STRING_FIELDS,
} from "@/lib/platform/realtime/rule-fields";
import type { ThresholdAlertTemplate } from "@/lib/platform/realtime/templates";
import type { ThresholdAlertView } from "@/lib/platform/alerts/threshold";
import { AlertsPageFrame } from "./alerts-shell";
import { alertsRequest } from "./alert-api";
import { conditionSummary, filtersSummary, metricLabel, metricUnit, operatorSymbol } from "./alert-format";
import AlertDeliveryExtension, { type AlertDeliveryValue } from "@/components/(playground)/alerts/alert-delivery-extension";

const MATCH_FIELDS = [...REALTIME_STRING_FIELDS, ...REALTIME_NUMERIC_FIELDS, ...REALTIME_ATTRIBUTE_FIELDS];
const GROUP_FIELDS = [...REALTIME_STRING_FIELDS, ...REALTIME_ATTRIBUTE_FIELDS];
const WINDOWS = [60, 300, 600, 900, 1800, 3600];
const TRIGGER = "h-8 bg-white px-2 text-xs dark:bg-stone-950";
const LABEL = "text-[11px] font-medium text-stone-600 dark:text-stone-300";

type Condition = { field: string; op: string; value: string };

type Draft = {
	name: string;
	description: string;
	severity: RealtimeSeverity;
	enabled: boolean;
	metric: string;
	operator: string;
	threshold: string;
	windowSec: string;
	minSamples: string;
	cooldownSec: string;
	groupBy: string[];
	match: Condition[];
};

const BLANK: Draft = {
	name: "",
	description: "",
	severity: "warning",
	enabled: true,
	metric: "error_rate",
	operator: "gt",
	threshold: "0.25",
	windowSec: "300",
	minSamples: "10",
	cooldownSec: "900",
	groupBy: ["service"],
	match: [],
};

function fromView(view: {
	name: string;
	description?: string;
	severity: RealtimeSeverity;
	enabled: boolean;
	definition: ThresholdAlertView["definition"];
}): Draft {
	const d = view.definition;
	return {
		name: view.name,
		description: view.description || "",
		severity: view.severity,
		enabled: view.enabled,
		metric: d.metric || "error_rate",
		operator: d.operator || "gt",
		threshold: String(d.threshold ?? ""),
		windowSec: String(d.windowSec ?? 300),
		minSamples: String(d.minSamples ?? 1),
		cooldownSec: String(d.cooldownSec ?? 900),
		groupBy: d.groupBy || [],
		match: (d.match || []).map((c) => ({ field: c.field, op: c.op, value: (c.values || []).join(", ") })),
	};
}

function toBody(draft: Draft) {
	return {
		name: draft.name.trim(),
		description: draft.description.trim(),
		mode: "window",
		kind: draft.metric === "cost" ? "cost" : "threshold",
		severity: draft.severity,
		enabled: draft.enabled,
		definition: {
			metric: draft.metric,
			operator: draft.operator,
			threshold: Number(draft.threshold),
			windowSec: Number(draft.windowSec),
			minSamples: Number(draft.minSamples),
			cooldownSec: Number(draft.cooldownSec),
			groupBy: draft.groupBy,
			match: draft.match.map((c) => ({
				field: c.field,
				op: c.op,
				values: c.op === "exists" ? [] : c.value.split(",").map((v) => v.trim()).filter(Boolean),
			})),
		},
	};
}

function Options({
	value,
	options,
	onChange,
	className = "w-full",
	labelFor = (v: string) => v,
}: {
	value: string;
	options: readonly string[];
	onChange: (value: string) => void;
	className?: string;
	labelFor?: (value: string) => string;
}) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger className={`${TRIGGER} ${className}`}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option} value={option} className="text-xs">
						{labelFor(option)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<label className="flex min-w-0 flex-col gap-1">
			<span className={LABEL}>{label}</span>
			{children}
			{hint ? <span className="text-[11px] text-stone-500 dark:text-stone-400">{hint}</span> : null}
		</label>
	);
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
	return (
		<section className="rounded-md border border-stone-200 bg-white p-4 text-stone-900 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100">
			<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">{title}</h2>
			{description ? <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{description}</p> : null}
			<div className="mt-3 flex flex-col gap-3">{children}</div>
		</section>
	);
}

/**
 * One-step threshold alert form. `header` renders above the form; the
 * enterprise overlay uses it for the Threshold / Event switch on New alert.
 */
export default function ThresholdAlertForm({ alertId, header }: { alertId?: string; header?: ReactNode }) {
	const m = getMessage();
	const router = useRouter();
	const editing = !!alertId;
	const [draft, setDraft] = useState<Draft | null>(editing ? null : BLANK);
	const [templates, setTemplates] = useState<ThresholdAlertTemplate[]>([]);
	const [templateId, setTemplateId] = useState<string>("");
	const [delivery, setDelivery] = useState<AlertDeliveryValue>({});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (editing) {
			alertsRequest<ThresholdAlertView>(`/api/alerts/threshold/${alertId}`)
				.then((view) => setDraft(fromView(view)))
				.catch((err) => setError(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED));
		} else {
			alertsRequest<ThresholdAlertTemplate[]>("/api/alerts/threshold/templates")
				.then(setTemplates)
				.catch(() => setTemplates([]));
		}
	}, [alertId, editing, m.ALERT_THRESHOLD_FAILED]);

	const preview = useMemo(() => {
		if (!draft) return "";
		const body = toBody(draft);
		return m.ALERTING_PREVIEW(conditionSummary(body.definition), filtersSummary(body.definition.match));
	}, [draft, m]);

	if (!draft) {
		return (
			<AlertsPageFrame>
				<div className="flex flex-col gap-3 p-4">
					{error ? <p className="text-xs text-red-600">{error}</p> : <Skeleton className="h-64 w-full" />}
				</div>
			</AlertsPageFrame>
		);
	}

	const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
	const applyTemplate = (template: ThresholdAlertTemplate | null) => {
		setTemplateId(template?.id || "");
		setDraft(template ? fromView({ ...template.input }) : BLANK);
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const body = { ...toBody(draft), delivery };
			const saved = editing
				? await alertsRequest<ThresholdAlertView>(`/api/alerts/threshold/${alertId}`, { method: "PATCH", body })
				: await alertsRequest<ThresholdAlertView>("/api/alerts/threshold", { method: "POST", body });
			toast.success(editing ? m.ALERTING_SAVED : m.ALERTING_CREATED);
			router.push(`/alerts/${saved.id}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : m.ALERT_THRESHOLD_FAILED);
		} finally {
			setSaving(false);
		}
	};

	const remainingGroups = GROUP_FIELDS.filter((field) => !draft.groupBy.includes(field));

	return (
		<AlertsPageFrame
			title={editing ? m.ALERTING_EDIT_TITLE : m.ALERTING_NEW_TITLE}
			leading={
				<Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50" asChild>
					<Link href={editing ? `/alerts/${alertId}` : "/alerts/list"} aria-label={m.ALERTING_BACK}>
						<ArrowLeft className="h-4 w-4" />
					</Link>
				</Button>
			}
		>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
					{header}
					{!editing && templates.length ? (
						<Section title={m.ALERTING_START_FROM} description={m.ALERTING_START_FROM_HINT}>
							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
								<button
									type="button"
									onClick={() => applyTemplate(null)}
									className={`rounded-md border px-3 py-2 text-left text-xs transition ${templateId === "" ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40" : "border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
								>
									<p className="font-medium text-stone-900 dark:text-stone-50">{m.ALERTING_TEMPLATE_BLANK}</p>
									<p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">{m.ALERTING_TEMPLATE_BLANK_HINT}</p>
								</button>
								{templates.map((template) => (
									<button
										key={template.id}
										type="button"
										onClick={() => applyTemplate(template)}
										className={`rounded-md border px-3 py-2 text-left text-xs transition ${templateId === template.id ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40" : "border-stone-200 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
									>
										<p className="font-medium text-stone-900 dark:text-stone-50">{template.name}</p>
										<p className="mt-0.5 line-clamp-2 text-[11px] text-stone-500 dark:text-stone-400">{template.description}</p>
									</button>
								))}
							</div>
						</Section>
					) : null}

					<Section title={m.ALERTING_SECTION_DETAILS}>
						<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
							<Field label={m.ALERTING_FIELD_NAME}>
								<Input
									value={draft.name}
									maxLength={REALTIME_RULE_LIMITS.maxName}
									onChange={(e) => set({ name: e.target.value })}
									placeholder={m.ALERTING_FIELD_NAME_PLACEHOLDER}
									className="h-8 text-xs"
								/>
							</Field>
							<Field label={m.ALERTING_FIELD_SEVERITY}>
								<Options value={draft.severity} options={REALTIME_SEVERITIES} onChange={(v) => set({ severity: v as RealtimeSeverity })} />
							</Field>
						</div>
						<Field label={m.ALERTING_FIELD_DESCRIPTION}>
							<Textarea
								value={draft.description}
								maxLength={500}
								rows={2}
								onChange={(e) => set({ description: e.target.value })}
								className="text-xs"
							/>
						</Field>
					</Section>

					<Section title={m.ALERTING_SECTION_CONDITION} description={m.ALERTING_SECTION_CONDITION_HINT}>
						<div className="grid gap-3 sm:grid-cols-4">
							<Field label={m.ALERTING_FIELD_METRIC}>
								<Options value={draft.metric} options={REALTIME_RULE_METRICS} onChange={(v) => set({ metric: v })} labelFor={metricLabel} />
							</Field>
							<Field label={m.ALERTING_FIELD_OPERATOR}>
								<Options value={draft.operator} options={REALTIME_RULE_OPERATORS} onChange={(v) => set({ operator: v })} labelFor={operatorSymbol} />
							</Field>
							<Field label={m.ALERTING_FIELD_THRESHOLD} hint={metricUnit(draft.metric)}>
								<Input type="number" min={0} step="any" value={draft.threshold} onChange={(e) => set({ threshold: e.target.value })} className="h-8 text-xs" />
							</Field>
							<Field label={m.ALERTING_FIELD_WINDOW}>
								<Options
									value={draft.windowSec}
									options={Array.from(new Set([...WINDOWS.map(String), draft.windowSec]))}
									onChange={(v) => set({ windowSec: v })}
									labelFor={(v) => (Number(v) % 60 === 0 ? `${Number(v) / 60} min` : `${v}s`)}
								/>
							</Field>
						</div>
						<div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
							<Field label={m.ALERTING_FIELD_GROUP_BY} hint={m.ALERTING_FIELD_GROUP_BY_HINT}>
								<div className="flex min-h-8 flex-wrap items-center gap-1.5">
									{draft.groupBy.map((field) => (
										<span key={field} className="inline-flex items-center gap-1 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 font-mono text-[11px] text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
											{field}
											<button type="button" aria-label={m.ALERTING_REMOVE} className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-50" onClick={() => set({ groupBy: draft.groupBy.filter((f) => f !== field) })}>
												<X className="h-3 w-3" />
											</button>
										</span>
									))}
									{draft.groupBy.length < REALTIME_RULE_LIMITS.maxGroupBy ? (
										<Select value="" onValueChange={(v) => set({ groupBy: [...draft.groupBy, v] })}>
											<SelectTrigger className={`${TRIGGER} w-32`}>
												<SelectValue placeholder={m.ALERTING_ADD_GROUP} />
											</SelectTrigger>
											<SelectContent>
												{remainingGroups.map((field) => (
													<SelectItem key={field} value={field} className="text-xs">
														{field}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									) : null}
								</div>
							</Field>
							<Field label={m.ALERTING_FIELD_MIN_SAMPLES} hint={m.ALERTING_FIELD_MIN_SAMPLES_HINT}>
								<Input type="number" min={1} value={draft.minSamples} onChange={(e) => set({ minSamples: e.target.value })} className="h-8 text-xs" />
							</Field>
							<Field label={m.ALERTING_FIELD_COOLDOWN} hint={m.ALERTING_FIELD_COOLDOWN_HINT}>
								<Input
									type="number"
									min={REALTIME_RULE_LIMITS.minCooldownSec}
									max={REALTIME_RULE_LIMITS.maxCooldownSec}
									value={draft.cooldownSec}
									onChange={(e) => set({ cooldownSec: e.target.value })}
									className="h-8 text-xs"
								/>
							</Field>
						</div>
					</Section>

					<Section title={m.ALERTING_SECTION_FILTERS} description={m.ALERTING_SECTION_FILTERS_HINT}>
						{draft.match.map((condition, index) => {
							const update = (patch: Partial<Condition>) => {
								const match = [...draft.match];
								match[index] = { ...condition, ...patch };
								set({ match });
							};
							return (
								<div key={index} className="flex flex-wrap items-center gap-2">
									<Options value={condition.field} options={MATCH_FIELDS} onChange={(field) => update({ field })} className="w-52" />
									<Options value={condition.op} options={REALTIME_CONDITION_OPS} onChange={(op) => update({ op })} className="w-28" labelFor={operatorSymbol} />
									{condition.op !== "exists" ? (
										<Input
											value={condition.value}
											maxLength={REALTIME_RULE_LIMITS.maxValueLength}
											onChange={(e) => update({ value: e.target.value })}
											placeholder={m.ALERTING_FILTER_VALUE_PLACEHOLDER}
											className="h-8 w-60 text-xs"
										/>
									) : null}
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-50"
										aria-label={m.ALERTING_REMOVE}
										onClick={() => set({ match: draft.match.filter((_, i) => i !== index) })}
									>
										<X className="h-3.5 w-3.5" />
									</Button>
								</div>
							);
						})}
						{draft.match.length < REALTIME_RULE_LIMITS.maxConditions ? (
							<Button
								variant="outline"
								size="sm"
								className="h-8 w-fit gap-1 text-xs text-stone-700 dark:text-stone-200"
								onClick={() => set({ match: [...draft.match, { field: "model", op: "eq", value: "" }] })}
							>
								<Plus className="h-3.5 w-3.5" />
								{m.ALERTING_ADD_FILTER}
							</Button>
						) : null}
					</Section>

					<Section title={m.ALERTING_SECTION_DELIVERY}>
						<AlertDeliveryExtension alertId={alertId} value={delivery} onChange={setDelivery} />
					</Section>

					<div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-md border border-stone-200 bg-white/95 p-3 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
						<p className="min-w-0 flex-1 text-xs text-stone-600 dark:text-stone-300">{preview}</p>
						<label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
							<Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
							{m.ALERTING_COLUMN_ENABLED}
						</label>
						<Button size="sm" className="h-8" disabled={saving || !draft.name.trim()} onClick={save}>
							{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
							{editing ? m.ALERTING_SAVE : m.ALERTING_CREATE}
						</Button>
					</div>
					{error ? (
						<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
							{error}
						</div>
					) : null}
				</div>
			</div>
		</AlertsPageFrame>
	);
}
