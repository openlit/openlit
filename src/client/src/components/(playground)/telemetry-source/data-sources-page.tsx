"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
	Database,
	Lock,
	Plus,
	Layers,
	Trash2,
	Wifi,
	Eye,
	ShieldCheck,
	Settings2,
	BookOpen,
	ExternalLink,
} from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import getMessage from "@/constants/messages";
import type { FieldDef } from "@/lib/platform/datasource/types";
import { fetchDatabaseConfigList } from "@/helpers/client/database-config";
import { getDatabaseConfigList } from "@/selectors/database-config";
import { useRootStore } from "@/store";

type Signal = "traces" | "logs" | "metrics";
const SIGNALS: Signal[] = ["traces", "logs", "metrics"];
const BUILTIN = "builtin";

interface TypeDescriptor {
	type: string;
	displayName: string;
	description?: string;
	icon?: string;
	declaredSignals: Signal[];
	correlation?: { crossSignal: boolean; keys: string[] };
	configFields?: FieldDef[];
	authStyle?: "none" | "http" | "api-key" | "custom";
	authHelp?: string;
	docsUrl?: string;
}

/** Config fields for a type from the fetched descriptors (descriptor-driven). */
function fieldsForType(
	descriptors: TypeDescriptor[],
	type: string
): FieldDef[] {
	return descriptors.find((d) => d.type === type)?.configFields ?? [];
}

interface SourceRow {
	id: string;
	name: string;
	type: string;
	environment: string;
	signals: string;
	settings: string;
	isDefault: boolean;
	hasSecret?: boolean;
}

interface BindingRow {
	signal: string;
	environment?: string;
	sourceId: string;
	sourceName: string | null;
	sourceType: string | null;
}

interface StackTemplate {
	template: string;
	displayName: string;
	slots: { key: string; type: string; signal: Signal }[];
}

function parseSignals(csv: string): Signal[] {
	return csv
		.split(",")
		.map((s) => s.trim())
		.filter((s): s is Signal => SIGNALS.includes(s as Signal));
}

async function jsonFetch(url: string, init?: RequestInit) {
	const res = await fetch(url, init);
	const text = await res.text();
	let body: any = undefined;
	try {
		body = text ? JSON.parse(text) : undefined;
	} catch {
		body = text;
	}
	if (!res.ok) {
		const err =
			(body && (body.err || body.error || body.message)) ||
			(typeof body === "string" ? body : "Request failed");
		throw new Error(err);
	}
	return body;
}

export default function DataSourcesPage({
	projectId,
	showRouting = true,
	openType,
	onOpenTypeHandled,
}: {
	projectId?: string;
	showRouting?: boolean;
	openType?: string | null;
	onOpenTypeHandled?: () => void;
}) {
	const messages = getMessage();
	const searchParams = useSearchParams();
	const routeEnvironment = searchParams.get("environment") || "production";
	const databaseConfigs = useRootStore(getDatabaseConfigList) || [];
	const [loading, setLoading] = useState(true);
	const [sources, setSources] = useState<SourceRow[]>([]);
	const [descriptors, setDescriptors] = useState<TypeDescriptor[]>([]);
	const [bindings, setBindings] = useState<BindingRow[]>([]);
	const [templates, setTemplates] = useState<StackTemplate[]>([]);
	const [editing, setEditing] = useState<SourceRow | "new" | null>(null);
	const [newType, setNewType] = useState<string | undefined>();
	const [stackOpen, setStackOpen] = useState(false);
	const [testingId, setTestingId] = useState<string | null>(null);
	const [environment, setEnvironment] = useState(routeEnvironment);
	const visibleSources = useMemo(
		() => sources.filter((source) => (source.environment || "production") === environment),
		[environment, sources]
	);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [list, binds, stacks] = await Promise.all([
				jsonFetch("/api/telemetry-source"),
				jsonFetch(`/api/telemetry-source/binding?environment=${encodeURIComponent(environment)}`),
				jsonFetch("/api/telemetry-source/stack"),
			]);
			setSources(list?.sources || []);
			setDescriptors(list?.availableTypeDescriptors || []);
			setBindings(binds?.bindings || []);
			setTemplates(stacks?.templates || []);
		} catch (e: any) {
			toast.error(e?.message || messages.DATA_SOURCE_LOAD_FAILED);
		} finally {
			setLoading(false);
		}
	}, [environment, messages.DATA_SOURCE_LOAD_FAILED]);

	useEffect(() => {
		if (routeEnvironment !== environment) setEnvironment(routeEnvironment);
	}, [environment, routeEnvironment]);

	useEffect(() => {
		if (openType) {
			setNewType(openType);
			setEditing("new");
			onOpenTypeHandled?.();
		}
	}, [onOpenTypeHandled, openType]);

	useEffect(() => {
		fetchDatabaseConfigList(() => {});
		load();
	}, [load, projectId]);

	const bindingForSignal = useCallback(
		(signal: Signal) => bindings.find(
			(b) => b.signal === signal && (b.environment || "production") === environment
		),
		[bindings, environment]
	);

	const setBinding = async (signal: Signal, sourceId: string) => {
		toast.loading(messages.DATA_SOURCE_BINDING_SAVED, { id: "ds-bind" });
		try {
			if (sourceId === BUILTIN) {
				await jsonFetch(
					`/api/telemetry-source/binding?signal=${encodeURIComponent(signal)}&environment=${encodeURIComponent(environment)}`,
					{ method: "DELETE" }
				);
			} else {
				await jsonFetch("/api/telemetry-source/binding", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ signal, sourceId, environment }),
				});
			}
			toast.success(messages.DATA_SOURCE_BINDING_SAVED, { id: "ds-bind" });
			await load();
		} catch (e: any) {
			toast.error(e?.message || messages.DATA_SOURCE_BINDING_FAILED, {
				id: "ds-bind",
			});
		}
	};

	const removeSource = async (row: SourceRow) => {
		if (!window.confirm(messages.DATA_SOURCE_DELETE_CONFIRM(row.name))) return;
		toast.loading(messages.DATA_SOURCE_DELETED, { id: "ds-del" });
		try {
			await jsonFetch(`/api/telemetry-source/${row.id}`, { method: "DELETE" });
			toast.success(messages.DATA_SOURCE_DELETED, { id: "ds-del" });
			await load();
		} catch (e: any) {
			toast.error(e?.message || messages.DATA_SOURCE_DELETE_FAILED, {
				id: "ds-del",
			});
		}
	};

	const testSource = async (row: SourceRow) => {
		setTestingId(row.id);
		toast.loading(messages.DATA_SOURCE_TESTING, { id: "ds-test" });
		try {
			const res = await jsonFetch(`/api/telemetry-source/${row.id}/health`);
			const health = res?.health;
			const validation = res?.validation;
			if (!health?.ok) {
				const raw = String(health?.message || "");
				const usesHttpAuth =
					descriptors.find((d) => d.type === row.type)?.authStyle === "http";
				const hint =
					/401|no credentials|unauthorized/i.test(raw) && usesHttpAuth
						? ` ${messages.DATA_SOURCE_AUTH_401_HINT}`
						: "";
				toast.error(
					(health?.message || messages.DATA_SOURCE_SAVE_FAILED) + hint,
					{ id: "ds-test" }
				);
				return;
			}
			// Loki/Mimir (and other non-trace sources) skip AI-span validation.
			if (validation?.supported === false) {
				toast.success(messages.DATA_SOURCE_TEST_OK, { id: "ds-test" });
				return;
			}
			if (validation?.ok && validation.sampleCount > 0) {
				toast.success(messages.DATA_SOURCE_TEST_AI_OK(validation.sampleCount), {
					id: "ds-test",
				});
			} else {
				toast.message(messages.DATA_SOURCE_TEST_AI_NONE, { id: "ds-test" });
			}
		} catch (e: any) {
			toast.error(e?.message || messages.DATA_SOURCE_SAVE_FAILED, {
				id: "ds-test",
			});
		} finally {
			setTestingId(null);
		}
	};

	return (
		<div className="flex h-full w-full flex-col gap-4 overflow-auto text-stone-700 dark:text-stone-300">
			{/* Locked built-in / derived intelligence indicator */}
			<section className="border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
				<div className="mb-3 flex items-center gap-2">
					<Lock className="h-4 w-4 text-primary" />
					<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
						{messages.DATA_SOURCE_BUILTIN_TITLE}
					</h2>
				</div>
				<div className="space-y-1.5">
					<Label className="text-xs uppercase text-muted-foreground">
						{messages.DATA_SOURCE_BUILTIN_FIELD_LABEL}
					</Label>
					<Select value={BUILTIN} disabled>
						<SelectTrigger className="w-full max-w-md bg-stone-50 dark:bg-stone-900">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={BUILTIN}>
								{messages.DATA_SOURCE_SIGNAL_BUILTIN_OPTION}
							</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">
						{messages.DATA_SOURCE_BUILTIN_DERIVED}
					</p>
				</div>
			</section>

			{/* Per-signal routing */}
			{showRouting && (
			<section className="border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
				<div className="mb-1 flex items-center gap-2">
					<Database className="h-4 w-4 text-primary" />
					<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
						{messages.DATA_SOURCE_SIGNAL_ROUTING_TITLE}
					</h2>
				</div>
				<p className="mb-3 text-xs text-muted-foreground">
					{messages.DATA_SOURCE_SIGNAL_ROUTING_DESCRIPTION}
				</p>
				<div className="grid gap-3 sm:grid-cols-3">
					{SIGNALS.map((signal) => {
						const binding = bindingForSignal(signal);
						const currentDatabase = databaseConfigs.find(
							(db) => (db.environment || "production").toLowerCase() === environment
						);
						const value = binding?.sourceId || (currentDatabase ? `builtin:${currentDatabase.id}` : BUILTIN);
						const options = visibleSources.filter((s) =>
							parseSignals(s.signals).includes(signal)
						);
						const label =
							signal === "traces"
								? messages.DATA_SOURCE_SIGNAL_TRACES
								: signal === "logs"
								? messages.DATA_SOURCE_SIGNAL_LOGS
								: messages.DATA_SOURCE_SIGNAL_METRICS;
						return (
							<div key={signal} className="space-y-1.5">
								<Label className="text-xs uppercase text-muted-foreground">
									{label}
								</Label>
								<Select
									value={value}
									onValueChange={(v) => setBinding(signal, v)}
								>
									<SelectTrigger className="w-full bg-white dark:bg-stone-900">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{databaseConfigs
											.filter((db) => (db.environment || "production").toLowerCase() === environment)
											.map((db) => (
												<SelectItem key={db.id} value={`builtin:${db.id}`}>
													{db.name} · ClickHouse
												</SelectItem>
											))}
						{databaseConfigs.filter((db) => (db.environment || "production").toLowerCase() === environment).length === 0 && <SelectItem value={BUILTIN}>{messages.DATA_SOURCE_SIGNAL_BUILTIN_OPTION}</SelectItem>}
										{options.map((s) => (
											<SelectItem key={s.id} value={s.id}>
												{s.name} ({s.type})
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						);
					})}
				</div>
			</section>
			)}

			{/* External sources list */}
			<section className="border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<div>
						<div className="flex items-center gap-2">
							<Layers className="h-4 w-4 text-primary" />
							<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
								{messages.DATA_SOURCE_SOURCES_TITLE}
							</h2>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">
							{messages.DATA_SOURCE_SOURCES_DESCRIPTION}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => setStackOpen(true)}
						>
							<Layers className="mr-1.5 h-3.5 w-3.5" />
							{messages.DATA_SOURCE_ADD_STACK}
						</Button>
						<Button size="sm" onClick={() => setEditing("new")}>
							<Plus className="mr-1.5 h-3.5 w-3.5" />
							{messages.DATA_SOURCE_ADD}
						</Button>
					</div>
				</div>

				{loading ? (
					<div className="animate-pulse py-8 text-center text-sm text-muted-foreground">
						{messages.OBSERVABILITY_LOADING}
					</div>
				) : visibleSources.length === 0 ? (
					<div className="flex flex-col items-center gap-1 py-10 text-center">
						<h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
							{messages.DATA_SOURCE_EMPTY_TITLE}
						</h3>
						<p className="max-w-md text-sm text-muted-foreground">
							{messages.DATA_SOURCE_EMPTY_DESCRIPTION}
						</p>
					</div>
				) : (
					<div className="grid gap-3 md:grid-cols-2">
						{visibleSources.map((s) => (
							<div
								key={s.id}
								className="flex min-h-[168px] flex-col justify-between rounded-lg border border-stone-200 bg-stone-50/70 p-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-primary/50"
							>
								<div>
									<div className="flex items-center gap-2">
										<div className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950">
											<Image src={descriptors.find((d) => d.type === s.type)?.icon || "/images/connect.svg"} alt="" width={24} height={24} className="h-6 w-6 object-contain" />
										</div>
										<span className="text-sm font-medium text-stone-950 dark:text-stone-50">
											{s.name}
										</span>
										<Badge variant="outline" className="text-[10px]">
										{s.type}
									</Badge>
									<Badge variant="secondary" className="text-[10px]">
										{s.environment || "production"}
									</Badge>
										{s.isDefault && (
											<Badge className="text-[10px]">default</Badge>
										)}
										{s.hasSecret && (
											<span
												className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
												title={messages.DATA_SOURCE_CREDENTIALS_SET}
											>
												<ShieldCheck className="h-3 w-3" />
											</span>
										)}
									</div>
									<p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
										{descriptors.find((d) => d.type === s.type)?.description || `${s.type} telemetry connector.`}
									</p>
									<div className="flex flex-wrap gap-1">
										{parseSignals(s.signals).map((sig) => (
											<Badge
												key={sig}
												variant="secondary"
												className="text-[10px]"
											>
												{sig}
											</Badge>
										))}
									</div>
								</div>
								<div className="mt-3 flex items-center justify-between gap-1 border-t border-stone-200 pt-2 dark:border-stone-800">
									<span className="text-[11px] text-muted-foreground">{messages.DATA_SOURCE_VIEW_DETAILS}</span>
									<div className="flex items-center gap-1">
									<Button
										size="sm"
										variant="ghost"
										disabled={testingId === s.id}
										onClick={() => testSource(s)}
									>
										<Wifi className="mr-1 h-3.5 w-3.5" />
										{messages.DATA_SOURCE_TEST}
									</Button>
					<Button
						size="sm"
						variant="ghost"
						title="View connector details and signal routing"
						aria-label={`View ${s.name} details`}
						onClick={() => setEditing(s)}
					>
										<Eye className="h-3.5 w-3.5" />
										</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => removeSource(s)}
									>
											<Trash2 className="h-3.5 w-3.5 text-error" />
										</Button>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			{editing && (
				<SourceFormDialog
					source={editing === "new" ? null : editing}
					descriptors={descriptors}
					initialType={editing === "new" ? newType : undefined}
					initialEnvironment={environment}
					showRouting={showRouting || editing !== "new"}
					bindingForSignal={bindingForSignal}
					onSetBinding={setBinding}
					bindings={bindings}
					sources={visibleSources}
					databaseConfigs={databaseConfigs}
					environment={environment}
					onClose={() => {
						setEditing(null);
						setNewType(undefined);
					}}
					onSaved={async () => {
						setEditing(null);
						setNewType(undefined);
						await load();
					}}
				/>
			)}

			{stackOpen && (
				<StackDialog
					templates={templates}
					descriptors={descriptors}
					initialEnvironment={environment}
					onClose={() => setStackOpen(false)}
					onSaved={async () => {
						setStackOpen(false);
						await load();
					}}
				/>
			)}
		</div>
	);
}

function FieldInput({
	field,
	value,
	onChange,
}: {
	field: FieldDef;
	value: string | boolean;
	onChange: (v: string | boolean) => void;
}) {
	if (field.kind === "switch") {
		return (
			<div className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
				<Label className="text-xs">{field.label}</Label>
				<Switch
					checked={!!value}
					onCheckedChange={(c) => onChange(c)}
				/>
			</div>
		);
	}
	if (field.kind === "select" && field.options) {
		return (
			<div className="space-y-1.5">
				<Label className="text-xs">{field.label}</Label>
				<Select value={String(value)} onValueChange={(v) => onChange(v)}>
					<SelectTrigger className="bg-white dark:bg-stone-900">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{field.options.map((o) => (
							<SelectItem key={o.value} value={o.value}>
								{o.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		);
	}
	return (
		<div className="space-y-1.5">
			<Label className="text-xs">{field.label}</Label>
			<Input
				type={field.kind === "password" ? "password" : "text"}
				value={String(value ?? "")}
				placeholder={field.placeholder}
				onChange={(e) => onChange(e.target.value)}
				className="bg-white dark:bg-stone-900"
			/>
		</div>
	);
}

function SignalRoutingEditor({
	sources,
	databaseConfigs,
	environment: routingEnvironment,
	bindingForSignal,
	onSetBinding,
	source,
}: {
	sources: SourceRow[];
	databaseConfigs: any[];
	environment: string;
	bindingForSignal: (signal: Signal) => BindingRow | undefined;
	onSetBinding: (signal: Signal, sourceId: string) => Promise<void>;
	source: SourceRow;
}) {
	const messages = getMessage();
	return (
		<div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3 dark:border-primary/30 dark:bg-primary/10">
			<div>
				<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.DATA_SOURCE_SIGNAL_ROUTING_TITLE}</p>
			<p className="text-[11px] leading-4 text-muted-foreground">{messages.DATA_SOURCE_SIGNAL_ROUTING_DIALOG_DESCRIPTION(routingEnvironment)}</p>
			</div>
			<div className="grid gap-2 sm:grid-cols-3">
				{SIGNALS.map((signal) => {
					const binding = bindingForSignal(signal);
					const currentDatabase = databaseConfigs.find(
						(db) => (db.environment || "production").toLowerCase() === routingEnvironment
					);
					const value = binding?.sourceId || (binding?.sourceName ? "" : currentDatabase ? `builtin:${currentDatabase.id}` : BUILTIN);
					const eligibleSources = sources.filter((item) => parseSignals(item.signals).includes(signal));
					return <div key={signal} className="space-y-1"><Label className="text-[11px] uppercase text-muted-foreground">{signal}</Label><Select value={value || BUILTIN} onValueChange={(next) => onSetBinding(signal, next)}><SelectTrigger className="bg-white dark:bg-stone-900"><SelectValue /></SelectTrigger><SelectContent>{databaseConfigs.filter((db) => (db.environment || "production").toLowerCase() === routingEnvironment).map((db) => <SelectItem key={db.id} value={`builtin:${db.id}`}>{db.name} · ClickHouse</SelectItem>)}{databaseConfigs.filter((db) => (db.environment || "production").toLowerCase() === routingEnvironment).length === 0 && <SelectItem value={BUILTIN}>{messages.DATA_SOURCE_SIGNAL_BUILTIN_OPTION}</SelectItem>}{eligibleSources.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.type}</SelectItem>)}</SelectContent></Select></div>;
				})}
			</div>
			<p className="text-[11px] text-muted-foreground">{messages.DATA_SOURCE_SIGNAL_ROUTING_DIALOG_FOOTER(source.name, routingEnvironment)}</p>
		</div>
	);
}

function SourceFormDialog({
	source,
	descriptors,
	initialType,
	initialEnvironment,
	showRouting = false,
	bindingForSignal,
	onSetBinding,
	bindings,
	sources,
	databaseConfigs,
	environment: routingEnvironment,
	onClose,
	onSaved,
}: {
	source: SourceRow | null;
	descriptors: TypeDescriptor[];
	initialType?: string;
	initialEnvironment?: string;
	showRouting?: boolean;
	bindingForSignal?: (signal: Signal) => BindingRow | undefined;
	onSetBinding?: (signal: Signal, sourceId: string) => Promise<void>;
	bindings?: BindingRow[];
	sources?: SourceRow[];
	databaseConfigs?: any[];
	environment?: string;
	onClose: () => void;
	onSaved: () => void;
}) {
	const messages = getMessage();
	const isEdit = !!source;
	const [name, setName] = useState(source?.name || "");
	const [environment, setEnvironment] = useState(source?.environment || initialEnvironment || "production");
	const [type, setType] = useState(source?.type || initialType || descriptors[0]?.type || "");
	const [isDefault, setIsDefault] = useState(!!source?.isDefault);
	const [values, setValues] = useState<Record<string, string | boolean>>({});
	const [saving, setSaving] = useState(false);

	const fields = useMemo(
		() => fieldsForType(descriptors, type),
		[descriptors, type]
	);

	// Seed defaults + stored settings whenever the type (or source) changes.
	useEffect(() => {
		const next: Record<string, string | boolean> = {};
		let stored: Record<string, unknown> = {};
		if (source?.settings) {
			try {
				stored = JSON.parse(source.settings) || {};
			} catch {
				stored = {};
			}
		}
		for (const f of fieldsForType(descriptors, type)) {
			if (f.group === "settings") {
				next[f.key] =
					stored[f.key] !== undefined
						? (stored[f.key] as string | boolean)
						: f.defaultValue ?? (f.kind === "switch" ? false : "");
			} else {
				next[f.key] = "";
			}
		}
		setValues(next);
	}, [type, source, descriptors]);

	const settingsFields = fields.filter((f) => f.group === "settings");
	const credentialFields = fields.filter((f) => f.group === "credentials");

	const submit = async () => {
		if (!name.trim()) {
			toast.error(messages.TELEMETRY_SOURCE_NAME_REQUIRED);
			return;
		}
		const settings: Record<string, unknown> = {};
		for (const f of settingsFields) settings[f.key] = values[f.key];
		const credentials: Record<string, string> = {};
		for (const f of credentialFields) {
			const v = values[f.key];
			if (typeof v === "string" && v.trim() !== "") credentials[f.key] = v;
		}

		setSaving(true);
		toast.loading(messages.DATA_SOURCE_SAVED, { id: "ds-save" });
		try {
			const payload: Record<string, unknown> = {
				name: name.trim(),
				environment: environment.trim().toLowerCase() || "production",
				settings,
				isDefault,
			};
			if (Object.keys(credentials).length) payload.credentials = credentials;
			if (isEdit) {
				await jsonFetch(`/api/telemetry-source/${source!.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
			} else {
				payload.type = type;
				await jsonFetch("/api/telemetry-source", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
			}
			toast.success(messages.DATA_SOURCE_SAVED, { id: "ds-save" });
			onSaved();
		} catch (e: any) {
			toast.error(e?.message || messages.DATA_SOURCE_SAVE_FAILED, {
				id: "ds-save",
			});
		} finally {
			setSaving(false);
		}
	};

	const activeDescriptor = descriptors.find((d) => d.type === type);
	const setupGuide = messages.DATA_SOURCE_SETUP_GUIDES[type];

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[92vh] overflow-y-auto border-stone-200 bg-white text-stone-950 shadow-2xl dark:border-stone-800 dark:bg-stone-950 dark:text-stone-50 sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>
						{isEdit ? messages.DATA_SOURCE_DETAILS : messages.DATA_SOURCE_ADD}
					</DialogTitle>
					<DialogDescription>
						{isEdit ? activeDescriptor?.description : messages.PROJECT_DATA_SOURCES_DESCRIPTION}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<section className="rounded-lg border border-primary/25 bg-primary/[0.04] p-4 dark:border-primary/35 dark:bg-primary/[0.08]">
						<div className="mb-3 flex items-center gap-2">
							<Settings2 className="h-4 w-4 text-primary" />
							<div>
								<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.DATA_SOURCE_CONNECTOR_SECTION}</p>
								<p className="text-[11px] text-muted-foreground">{messages.DATA_SOURCE_CONNECTOR_SECTION_DESCRIPTION}</p>
							</div>
						</div>
						<div className="space-y-1.5">
							<Label className="text-xs">{messages.DATA_SOURCE_FIELD_TYPE}</Label>
							<Select value={type} onValueChange={setType} disabled={isEdit}>
								<SelectTrigger className="h-auto min-h-14 items-center border-stone-300 bg-white py-2.5 text-left text-stone-950 [&>span]:line-clamp-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50">
									<SelectValue placeholder="Select a connector">
										{activeDescriptor ? (
											<div className="flex min-w-0 items-center gap-2.5">
												<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950">
													<Image src={activeDescriptor.icon || "/images/connect.svg"} alt="" width={20} height={20} className="h-5 w-5 object-contain" />
												</div>
												<div className="min-w-0">
													<p className="truncate text-sm font-medium">{activeDescriptor.displayName}</p>
													<p className="truncate text-[11px] text-muted-foreground">{activeDescriptor.description || `${activeDescriptor.displayName} telemetry connector.`}</p>
												</div>
											</div>
										) : undefined}
									</SelectValue>
								</SelectTrigger>
								<SelectContent className="grid max-h-96 min-w-[var(--radix-select-trigger-width)] grid-cols-2 gap-1 p-1 sm:min-w-[680px]">
									{descriptors.map((d) => (
										<SelectItem key={d.type} value={d.type} className="py-2.5">
											<div className="flex items-start gap-2.5">
												<div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950">
													<Image src={d.icon || "/images/connect.svg"} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
												</div>
												<div className="min-w-0">
													<p className="font-medium">{d.displayName}</p>
													<p className="mt-0.5 line-clamp-2 max-w-[220px] whitespace-normal text-[10px] leading-4 text-muted-foreground">{d.description || `${d.displayName} telemetry connector.`}</p>
												</div>
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{isEdit && <p className="text-[11px] text-muted-foreground">{messages.DATA_SOURCE_TYPE_LOCKED}</p>}
						</div>
						{activeDescriptor && (
							<div className="mt-3 flex flex-wrap items-center gap-1.5">
								<span className="mr-1 text-[11px] text-muted-foreground">{messages.DATA_SOURCE_SIGNALS_SECTION}:</span>
								{activeDescriptor.declaredSignals.map((sig) => (
									<Badge key={sig} variant="secondary" className="text-[10px]">{sig}</Badge>
								))}
							</div>
						)}
					</section>

					{setupGuide && (
						<details open className="rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
							<summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-semibold text-stone-950 marker:hidden dark:text-stone-50">
								<BookOpen className="h-4 w-4 text-primary" />
								{messages.DATA_SOURCE_SETUP_TITLE}
							</summary>
							<div className="mt-3 space-y-3 pl-6">
								<p className="text-[11px] leading-4 text-muted-foreground">{setupGuide.summary}</p>
								<ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-4 text-stone-700 dark:text-stone-300">
									{setupGuide.steps.map((step) => <li key={step}>{step}</li>)}
								</ol>
								<a href={setupGuide.docsUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[11px] font-medium text-primary underline underline-offset-2">
									{messages.DATA_SOURCE_DOCS_LINK}<ExternalLink className="h-3 w-3" />
								</a>
							</div>
						</details>
					)}

					<section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
						<div>
							<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.DATA_SOURCE_CONNECTION_SECTION}</p>
							<p className="mt-0.5 text-[11px] text-muted-foreground">{messages.DATA_SOURCE_CONNECTION_SECTION_DESCRIPTION}</p>
						</div>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1.5">
								<Label className="text-xs">{messages.DATA_SOURCE_FIELD_NAME}</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="prod-datadog"
								className="bg-white dark:bg-stone-900"
								/>
							</div>
							<div className="space-y-1.5">
						<Label className="text-xs">{messages.CONNECTOR_ENVIRONMENT}</Label>
						<Input value={environment} onChange={(e) => setEnvironment(e.target.value.toLowerCase())} placeholder={messages.CONNECTOR_ENVIRONMENT_PLACEHOLDER} className="border-stone-300 bg-white text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50" />
							</div>
						</div>
					</section>

					{settingsFields.length > 0 && <section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
						<div><p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.DATA_SOURCE_SETTINGS_SECTION}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{messages.DATA_SOURCE_SETTINGS_SECTION_DESCRIPTION}</p></div>
						<div className="grid gap-3 sm:grid-cols-2">{settingsFields.map((f) => (
						<FieldInput
							key={f.key}
							field={f}
							value={values[f.key] ?? ""}
							onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
						/>))}</div>
					</section>}

					{credentialFields.length > 0 && (
						<section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
							<div>
								<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">
									{messages.DATA_SOURCE_CREDENTIALS_TITLE}
								</p>
								<p className="text-xs text-muted-foreground">
									{isEdit && source?.hasSecret
										? messages.DATA_SOURCE_CREDENTIALS_SET
										: messages.DATA_SOURCE_CREDENTIALS_HELP}
								</p>
								{activeDescriptor?.authHelp && (
									<p className="mt-1 text-xs text-muted-foreground">
										{activeDescriptor.authHelp}
									</p>
								)}
								{activeDescriptor?.docsUrl && (
									<a
										href={activeDescriptor.docsUrl}
										target="_blank"
										rel="noreferrer noopener"
										className="mt-1 inline-block text-xs text-primary underline"
									>
										{messages.DATA_SOURCE_DOCS_LINK}
									</a>
								)}
							</div>
							<div className="grid gap-3 sm:grid-cols-2">{credentialFields.map((f) => (
								<FieldInput
									key={f.key}
									field={f}
									value={values[f.key] ?? ""}
									onChange={(v) =>
										setValues((p) => ({ ...p, [f.key]: v }))
									}
								/>
							))}</div>
						</section>
					)}

					{showRouting && source && bindingForSignal && onSetBinding && (
						<SignalRoutingEditor
							sources={sources || []}
							databaseConfigs={databaseConfigs || []}
							environment={routingEnvironment || "production"}
							bindingForSignal={bindingForSignal}
							onSetBinding={onSetBinding}
							source={source}
						/>
					)}

					<div className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
						<Label className="text-xs">
							{messages.DATA_SOURCE_FIELD_DEFAULT}
						</Label>
						<Switch checked={isDefault} onCheckedChange={setIsDefault} />
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={saving}>
						{messages.CANCEL}
					</Button>
					<Button onClick={submit} disabled={saving}>
						{messages.SAVE}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function StackDialog({
	templates,
	descriptors,
	initialEnvironment,
	onClose,
	onSaved,
}: {
	templates: StackTemplate[];
	descriptors: TypeDescriptor[];
	initialEnvironment?: string;
	onClose: () => void;
	onSaved: () => void;
}) {
	const messages = getMessage();
	const [templateKey, setTemplateKey] = useState(templates[0]?.template || "");
	const [name, setName] = useState("");
	const [environment, setEnvironment] = useState(initialEnvironment || "production");
	const [slotValues, setSlotValues] = useState<
		Record<string, Record<string, string | boolean>>
	>({});
	const [saving, setSaving] = useState(false);

	const template = templates.find((t) => t.template === templateKey);

	useEffect(() => {
		const next: Record<string, Record<string, string | boolean>> = {};
		for (const slot of template?.slots || []) {
			const values: Record<string, string | boolean> = {};
			for (const f of fieldsForType(descriptors, slot.type)) {
				values[f.key] =
					f.defaultValue ?? (f.kind === "switch" ? false : "");
			}
			next[slot.key] = values;
		}
		setSlotValues(next);
	}, [templateKey, template, descriptors]);

	const submit = async () => {
		if (!name.trim()) {
			toast.error(messages.TELEMETRY_SOURCE_NAME_REQUIRED);
			return;
		}
		const members = (template?.slots || []).map((slot) => {
			const fields = fieldsForType(descriptors, slot.type);
			const v = slotValues[slot.key] || {};
			const settings: Record<string, unknown> = {};
			const credentials: Record<string, string> = {};
			for (const f of fields) {
				if (f.group === "settings") {
					settings[f.key] = v[f.key];
				} else {
					const raw = v[f.key];
					if (typeof raw === "string" && raw.trim() !== "") {
						credentials[f.key] = raw.trim();
					}
				}
			}
			return {
				type: slot.type,
				settings,
				credentials,
				bind: true,
			};
		});

		setSaving(true);
		toast.loading(messages.DATA_SOURCE_STACK_SAVED, { id: "ds-stack" });
		try {
			await jsonFetch("/api/telemetry-source/stack", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: name.trim(), environment, members, bind: true }),
			});
			toast.success(messages.DATA_SOURCE_STACK_SAVED, { id: "ds-stack" });
			onSaved();
		} catch (e: any) {
			toast.error(e?.message || messages.DATA_SOURCE_SAVE_FAILED, {
				id: "ds-stack",
			});
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-h-[85vh] overflow-y-auto border-stone-200 bg-white text-stone-950 shadow-2xl dark:border-stone-800 dark:bg-stone-950 dark:text-stone-50 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{messages.DATA_SOURCE_STACK_TITLE}</DialogTitle>
					<DialogDescription>
						{messages.DATA_SOURCE_STACK_DESCRIPTION}
					</DialogDescription>
				</DialogHeader>
				<div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-stone-600 dark:border-primary/30 dark:bg-primary/10 dark:text-stone-300">
					This stack creates one connector for each signal slot and binds the complete stack to the selected environment. You can edit or reroute each connector after creation.
				</div>

				<div className="space-y-3">
					<div className="space-y-1.5">
						<Label className="text-xs">{messages.DATA_SOURCE_FIELD_NAME}</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="prod-grafana"
							className="bg-white dark:bg-stone-900"
						/>
					</div>

					<div className="space-y-1.5 rounded-md border border-primary/20 bg-primary/5 p-3 dark:border-primary/30 dark:bg-primary/10">
						<Label className="text-xs font-semibold">{messages.CONNECTOR_ENVIRONMENT}</Label>
						<Input value={environment} onChange={(e) => setEnvironment(e.target.value.toLowerCase())} placeholder={messages.CONNECTOR_ENVIRONMENT_PLACEHOLDER} className="border-stone-300 bg-white text-stone-950 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-50" />
						<p className="text-xs text-muted-foreground">{messages.CONNECTOR_ENVIRONMENT_DESCRIPTION}</p>
					</div>

					<div className="space-y-1.5">
						<Label className="text-xs">{messages.DATA_SOURCE_FIELD_TYPE}</Label>
						<Select value={templateKey} onValueChange={setTemplateKey}>
							<SelectTrigger className="border-stone-300 bg-white text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{templates.map((t) => (
									<SelectItem key={t.template} value={t.template}>
										{t.displayName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{descriptors.find(
						(d) => d.type === (template?.slots?.[0]?.type || "")
					)?.authStyle === "http" && (
						<p className="text-xs text-muted-foreground">
							{messages.DATA_SOURCE_AUTH_HELP_HTTP}
						</p>
					)}

					<Separator />

					{(template?.slots || []).map((slot) => {
						const fields = fieldsForType(descriptors, slot.type);
						const v = slotValues[slot.key] || {};
						const settingsFields = fields.filter((f) => f.group === "settings");
						const credentialFields = fields.filter(
							(f) => f.group === "credentials"
						);
						return (
							<div
								key={slot.key}
								className="space-y-2 rounded-lg border border-stone-200 bg-stone-50/70 p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900/50"
							>
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="text-[10px]">
										{slot.type}
									</Badge>
									<Badge variant="secondary" className="text-[10px]">
										{slot.signal}
									</Badge>
								</div>
								{settingsFields.map((f) => (
									<FieldInput
										key={f.key}
										field={f}
										value={v[f.key] ?? ""}
										onChange={(next) =>
											setSlotValues((p) => ({
												...p,
												[slot.key]: { ...v, [f.key]: next },
											}))
										}
									/>
								))}
								{credentialFields.map((f) => (
									<FieldInput
										key={f.key}
										field={f}
										value={v[f.key] ?? ""}
										onChange={(next) =>
											setSlotValues((p) => ({
												...p,
												[slot.key]: { ...v, [f.key]: next },
											}))
										}
									/>
								))}
							</div>
						);
					})}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={onClose} disabled={saving}>
						{messages.CANCEL}
					</Button>
					<Button onClick={submit} disabled={saving}>
						{messages.DATA_SOURCE_STACK_CREATE}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
