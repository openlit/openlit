"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	Database,
	Plus,
	Trash2,
	Wifi,
	Pencil,
	ShieldCheck,
	Settings2,
	BookOpen,
	ExternalLink,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import DatabaseConfigPage from "@/components/(playground)/database-config/database-config-page";
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
import { CLIENT_EVENTS } from "@/constants/events";
import FeatureAccess from "@/components/rbac/feature-access";
import {
	connectorCreateEventProps,
	signalRoutingChangedEventProps,
} from "@/helpers/client/connector-analytics";
import { usePostHog } from "posthog-js/react";

import type { FieldDef } from "@/lib/platform/connectors/datasource/types";
import { getDatabaseConfigList } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { getCurrentProjectEnvironment } from "@/selectors/project";
import { getRequestHeaders } from "@/utils/api";
import { isVisibleConnectorType } from "@/lib/platform/connectors/visible-types";

type Signal = "traces" | "logs" | "metrics" | "intelligence";
const SIGNALS: Signal[] = ["traces", "logs", "metrics", "intelligence"];
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

function isFieldVisible(
	field: FieldDef,
	values: Record<string, string | boolean>
): boolean {
	return !field.visibleWhen || values[field.visibleWhen.key] === field.visibleWhen.value;
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

function parseSignals(csv: string): Signal[] {
	return csv
		.split(",")
		.map((s) => s.trim())
		.filter((s): s is Signal => SIGNALS.includes(s as Signal));
}

/** Select value for connector / binding ids (connector registry already prefixes telemetry:). */
function signalRoutingSelectValue(sourceId?: string | null): string | undefined {
	const raw = String(sourceId || "").trim();
	if (!raw) return undefined;
	if (raw.startsWith("builtin:") || raw.startsWith("telemetry:")) return raw;
	return `telemetry:${raw}`;
}

function ConnectorOption({
	value,
	name,
	type,
	icon,
	detail,
}: {
	value: string;
	name: string;
	type: string;
	icon?: string;
	detail?: string;
}) {
	return (
		<SelectItem value={value} className="items-center py-2">
			<div className="flex min-w-0 items-center gap-2.5">
				<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950">
					<Image
						src={icon || "/images/connect.svg"}
						alt=""
						width={16}
						height={16}
						className="h-4 w-4 object-contain"
					/>
				</div>
				<div className="min-w-0 flex-1 text-left">
					<p className="truncate text-xs font-medium text-stone-950 dark:text-stone-50">
						{name}
					</p>
					<p className="truncate text-[10px] text-muted-foreground">
						{type}
						{detail ? ` · ${detail}` : ""}
					</p>
				</div>
			</div>
		</SelectItem>
	);
}

async function jsonFetch(url: string, init?: RequestInit) {
	const res = await fetch(url, {
		...init,
		headers: getRequestHeaders((init?.headers as Record<string, string> | undefined) || undefined),
	});
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
	const posthog = usePostHog();
	const currentProjectEnvironment = useRootStore(getCurrentProjectEnvironment);
	const databaseConfigs = useRootStore(getDatabaseConfigList) || [];
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [sources, setSources] = useState<SourceRow[]>([]);
	const [descriptors, setDescriptors] = useState<TypeDescriptor[]>([]);
	const [bindings, setBindings] = useState<BindingRow[]>([]);
	const [editing, setEditing] = useState<SourceRow | "new" | null>(null);
	const [newType, setNewType] = useState<string | undefined>();
	const [testingId, setTestingId] = useState<string | null>(null);
	const environment = currentProjectEnvironment || "production";
	const visibleSources = useMemo(
		() => sources.filter((source) => (source.environment || "production") === environment),
		[environment, sources]
	);

	const load = useCallback(async () => {
		setLoading(true);
		setLoadError(null);
		setSources([]);
		setBindings([]);
		try {
			const [list, binds] = await Promise.all([
				jsonFetch("/api/connectors"),
				jsonFetch("/api/telemetry-source/binding"),
			]);
			const connectors = list?.connectors || [];
			const clickHouseConfigs = connectors
				.filter((connector: any) => connector.type === "clickhouse")
				.map((connector: any) => {
					let settings: Record<string, any> = {};
					try { settings = JSON.parse(connector.settings || "{}"); } catch { /* use empty defaults */ }
					return {
						id: String(connector.id).replace(/^database:/, ""),
						name: connector.name,
						environment: connector.environment || "production",
						username: settings.username || "default",
						host: settings.host || "127.0.0.1",
						port: settings.port || "8123",
						database: settings.database || "openlit",
						query: settings.query || "",
						password: "",
						isCurrent: false,
						permissions: { canEdit: true, canDelete: true, canShare: true },
					};
				});
			useRootStore.getState().databaseConfig.setList(clickHouseConfigs);
			setSources(connectors.filter((connector: SourceRow) => isVisibleConnectorType(connector.type) && connector.type !== "clickhouse"));
			setDescriptors((list?.availableTypeDescriptors || []).filter((descriptor: TypeDescriptor) => isVisibleConnectorType(descriptor.type)));
			setBindings(binds?.bindings || []);
		} catch (e: any) {
			const message = e?.message || messages.DATA_SOURCE_LOAD_FAILED;
			setLoadError(message);
			toast.error(message, { id: "data-source-load" });
		} finally {
			setLoading(false);
		}
	}, [environment, messages.DATA_SOURCE_LOAD_FAILED]);

	useEffect(() => {
		if (openType) {
			setNewType(openType);
			setEditing("new");
			onOpenTypeHandled?.();
		}
	}, [onOpenTypeHandled, openType]);

	useEffect(() => {
		load();
		}, [load, projectId]);

	const bindingForSignal = useCallback(
		(signal: Signal) => bindings.find(
			(b) => b.signal === signal && (b.environment || "production") === environment
		),
		[bindings, environment]
	);
	const environmentDatabases = useMemo(
		() => databaseConfigs.filter((db) => (db.environment || "production").toLowerCase() === environment),
		[databaseConfigs, environment]
	);

	const setBinding = async (signal: Signal, sourceId: string) => {
		const previous = bindingForSignal(signal);
		const previousSourceId = previous?.sourceId || null;
		const previousConnectorType = previous?.sourceType || null;
		const nextConnectorType =
			sourceId === BUILTIN
				? null
				: sourceId.startsWith("builtin:")
					? "clickhouse"
					: sources.find((source) => signalRoutingSelectValue(source.id) === sourceId || source.id === sourceId)?.type || null;
		toast.loading(messages.DATA_SOURCE_BINDING_SAVED, { id: "ds-bind" });
		try {
			if (sourceId === BUILTIN) {
				await jsonFetch(
					`/api/telemetry-source/binding?signal=${encodeURIComponent(signal)}&environment=${encodeURIComponent(environment)}`,
					{ method: "DELETE" }
				);
			} else {
				let resolvedSourceId = sourceId;
				while (resolvedSourceId.startsWith("telemetry:")) {
					resolvedSourceId = resolvedSourceId.slice("telemetry:".length);
				}
				await jsonFetch("/api/telemetry-source/binding", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					signal,
					sourceId: resolvedSourceId,
					environment,
				}),
				});
			}
			posthog?.capture(
				CLIENT_EVENTS.SIGNAL_ROUTING_CHANGED,
				signalRoutingChangedEventProps({
					signal,
					environment,
					previousSourceId,
					nextSourceId: sourceId,
					previousConnectorType,
					nextConnectorType,
				})
			);
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
			await jsonFetch(`/api/connectors/${row.id}`, { method: "DELETE" });
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
			const res = await jsonFetch(`/api/connectors/${row.id}/health`, {
				method: "POST",
			});
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
			if (validation?.message) {
				const raw = String(validation.message);
				const hint = /401|no credentials|unauthorized/i.test(raw)
					? ` ${messages.DATA_SOURCE_AUTH_401_HINT}`
					: "";
				toast.error(
					messages.DATA_SOURCE_TEST_VALIDATION_FAILED(raw) + hint,
					{ id: "ds-test" }
				);
				return;
			}
			if (validation?.ok && validation.sampleCount > 0) {
				toast.success(messages.DATA_SOURCE_TEST_AI_OK(validation.sampleCount), {
					id: "ds-test",
				});
			} else {
				// Replace the loading toast with a finite, dismissible result. Using
				// toast.message here can leave the original loading notification
				// visible in Sonner when the validation returns zero samples.
				toast.success(messages.DATA_SOURCE_TEST_AI_NONE, { id: "ds-test" });
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
			{showRouting && (
				<SignalRoutingSection
					projectId={projectId}
					environment={environment}
					databaseConfigs={databaseConfigs}
					sources={visibleSources}
					descriptors={descriptors}
					bindingForSignal={bindingForSignal}
					onSetBinding={setBinding}
					onAddConnector={() => {
						setNewType(undefined);
						setEditing("new");
					}}
				/>
			)}
			<section className="grid gap-3 border border-stone-200 bg-white p-4 md:grid-cols-2 dark:border-stone-800 dark:bg-stone-950">
				<div className="-mx-4 -mt-4 flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 p-4 md:col-span-2 dark:border-stone-800">
					<div>
					<div className="flex items-center gap-2">
						<Database className="h-4 w-4 text-primary" />
						<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">Connectors · {environment}</h2>
					</div>
					<p className="mt-1 text-xs text-muted-foreground">{messages.PROJECT_CONNECTORS_DESCRIPTION} Add multiple ClickHouse targets and external integrations to each environment, then choose the connector used by each signal.</p>
					</div>
					<div className="flex items-center gap-2">
						<FeatureAccess access="connectors.create" hideWhenDenied>
							<Button size="sm" onClick={() => setEditing("new")}>
								<Plus className="mr-1.5 h-3.5 w-3.5" />
								{messages.DATA_SOURCE_ADD}
							</Button>
						</FeatureAccess>
					</div>
				</div>
				<div className="contents">
					<DatabaseConfigPage hideHeader hideEmpty />
				</div>
			<div className="contents">
			{/* External sources list */}
				{loading ? (
					<div className="contents">
						{[0].map((item) => (
							<div key={item} className="flex min-h-[168px] flex-col gap-4 rounded-lg border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/50">
								<div className="flex items-center gap-3"><div className="h-9 w-9 animate-pulse rounded-md bg-stone-200 dark:bg-stone-800" /><div className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-stone-200 dark:bg-stone-800" /><div className="h-2.5 w-20 animate-pulse rounded bg-stone-200 dark:bg-stone-800" /></div></div>
								<div className="space-y-2"><div className="h-2.5 w-full animate-pulse rounded bg-stone-200 dark:bg-stone-800" /><div className="h-2.5 w-3/4 animate-pulse rounded bg-stone-200 dark:bg-stone-800" /></div>
								<div className="mt-auto h-8 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
							</div>
						))}
					</div>
				) : loadError ? (
					<div className="rounded-lg border border-error/30 bg-error/5 p-6 text-center dark:bg-error/10">
						<p className="text-sm font-semibold text-error">{messages.DATA_SOURCE_LOAD_FAILED}</p>
						<p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">{loadError}</p>
						<Button size="sm" variant="outline" className="mt-4" onClick={() => void load()}>{messages.DATA_SOURCE_RETRY}</Button>
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
					<div className="contents">
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
				<div className="mt-3 flex items-center justify-end gap-1 border-t border-stone-200 pt-2 dark:border-stone-800">
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
						size="icon"
						variant="ghost"
						title="Edit connector and signal routing"
						aria-label={`Edit ${s.name} connector`}
						onClick={() => setEditing(s)}
					>
						<Pencil className="h-3.5 w-3.5" />
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
			</div>
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
			{field.description ? (
				<p className="text-[11px] leading-4 text-muted-foreground">{field.description}</p>
			) : null}
		</div>
	);
}

function SignalRoutingSection({
	projectId,
	environment,
	databaseConfigs,
	sources,
	descriptors,
	bindingForSignal,
	onSetBinding,
	onAddConnector,
}: {
	projectId?: string;
	environment: string;
	databaseConfigs: any[];
	sources: SourceRow[];
	descriptors: TypeDescriptor[];
	bindingForSignal: (signal: Signal) => BindingRow | undefined;
	onSetBinding: (signal: Signal, sourceId: string) => Promise<void>;
	onAddConnector?: () => void;
}) {
	const messages = getMessage();
	const environmentDatabases = databaseConfigs.filter(
		(db) => (db.environment || "production").toLowerCase() === environment
	);
	return (
		<section className="border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
			<div className="mb-1 flex items-center gap-2">
				<Database className="h-4 w-4 text-primary" />
				<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">{messages.DATA_SOURCE_SIGNAL_ROUTING_TITLE}</h2>
			</div>
			<p className="mb-3 text-xs text-muted-foreground">{messages.DATA_SOURCE_SIGNAL_ROUTING_DESCRIPTION}</p>
			<div className="grid gap-3 sm:grid-cols-3">
				{SIGNALS.map((signal) => {
					const binding = bindingForSignal(signal);
					const value = signalRoutingSelectValue(binding?.sourceId);
					const options = sources.filter((source) => parseSignals(source.signals).includes(signal));
					const hasOptions = environmentDatabases.length > 0 || options.length > 0;
					const label = signal === "traces" ? messages.DATA_SOURCE_SIGNAL_TRACES : signal === "logs" ? messages.DATA_SOURCE_SIGNAL_LOGS : signal === "metrics" ? messages.DATA_SOURCE_SIGNAL_METRICS : "Intelligence";
					return (
						<div key={signal} className="space-y-1.5">
							<Label className="text-xs uppercase text-muted-foreground">{label}</Label>
							{hasOptions ? (
								<FeatureAccess access="connectors.bind" hideWhenDenied>
									<Select value={value} onValueChange={(next) => onSetBinding(signal, next)}>
										<SelectTrigger className="h-auto min-h-12 items-center gap-2 overflow-hidden border-stone-300 bg-white py-2 text-left text-stone-950 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:line-clamp-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50"><SelectValue placeholder="Select a connector" /></SelectTrigger>
										<SelectContent className="w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-trigger-width)]">
											{environmentDatabases.map((db) => <ConnectorOption key={db.id} value={`builtin:${db.id}`} name={db.name} type="ClickHouse" detail={environment} icon="/images/connectors/clickhouse.svg" />)}
											{options.map((source) => <ConnectorOption key={source.id} value={signalRoutingSelectValue(source.id)!} name={source.name} type={source.type} detail={environment} icon={descriptors.find((descriptor) => descriptor.type === source.type)?.icon} />)}
										</SelectContent>
									</Select>
								</FeatureAccess>
							) : (
								<div className="flex min-h-12 items-center justify-between rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 text-xs text-muted-foreground dark:border-stone-700 dark:bg-stone-900/60">
									<span>No connector configured</span>
									{onAddConnector ? (
										<FeatureAccess access="connectors.create" hideWhenDenied>
											<button
												type="button"
												className="font-medium text-primary hover:underline"
												onClick={onAddConnector}
											>
												{messages.ADD_CONNECTOR}
											</button>
										</FeatureAccess>
									) : (
										<Link
											className="font-medium text-primary hover:underline"
											href={projectId ? `/organisation/project/${projectId}/connectors` : "/connectors"}
										>
											{messages.ADD_CONNECTOR}
										</Link>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</section>
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
					const value = signalRoutingSelectValue(binding?.sourceId);
					const eligibleSources = sources.filter((item) => parseSignals(item.signals).includes(signal));
					const routingDatabases = databaseConfigs.filter((db) => (db.environment || "production").toLowerCase() === routingEnvironment);
					const hasOptions = routingDatabases.length > 0 || eligibleSources.length > 0;
					return <div key={signal} className="space-y-1"><Label className="text-[11px] uppercase text-muted-foreground">{signal}</Label>{hasOptions ? <FeatureAccess access="connectors.bind" hideWhenDenied><Select value={value} onValueChange={(next) => onSetBinding(signal, next)}><SelectTrigger className="h-auto min-h-11 bg-white py-1.5 dark:bg-stone-900"><SelectValue placeholder="Select a connector" /></SelectTrigger><SelectContent className="w-[var(--radix-select-trigger-width)] min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-trigger-width)]">{routingDatabases.map((db) => <ConnectorOption key={db.id} value={`builtin:${db.id}`} name={db.name} type="ClickHouse" detail={routingEnvironment} icon="/images/connectors/clickhouse.svg" />)}{eligibleSources.map((item) => <ConnectorOption key={item.id} value={signalRoutingSelectValue(item.id)!} name={item.name} type={item.type} detail={routingEnvironment} />)}</SelectContent></Select></FeatureAccess> : <p className="rounded border border-dashed border-stone-300 p-2 text-[11px] text-muted-foreground dark:border-stone-700">No connector configured for {routingEnvironment}.</p>}</div>;
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
	const posthog = usePostHog();
	const isEdit = !!source;
	const [name, setName] = useState(source?.name || "");
	const [environment, setEnvironment] = useState(source?.environment || initialEnvironment || "production");
	const [environments, setEnvironments] = useState<string[]>(Array.from(new Set(["production", source?.environment, initialEnvironment].filter(Boolean) as string[])));
	const externalDescriptors = useMemo(() => descriptors.filter((descriptor) => descriptor.type !== "clickhouse"), [descriptors]);
	const [type, setType] = useState(source?.type || initialType || externalDescriptors[0]?.type || "");
	const clickHouseFields = useMemo<FieldDef[]>(() => [
		{ key: "username", label: messages.DB_CONFIG_FIELD_USERNAME, kind: "text", group: "settings", placeholder: "default" },
		{ key: "host", label: messages.DB_CONFIG_FIELD_HOST, kind: "text", group: "settings", placeholder: "clickhouse.example.com" },
		{ key: "port", label: messages.DB_CONFIG_FIELD_PORT, kind: "text", group: "settings", placeholder: "8123" },
		{ key: "database", label: messages.DB_CONFIG_FIELD_DATABASE, kind: "text", group: "settings", placeholder: "openlit" },
		{ key: "tracesTable", label: "Traces table", kind: "text", group: "settings", placeholder: "otel_traces", defaultValue: "otel_traces" },
		{ key: "logsTable", label: "Logs table", kind: "text", group: "settings", placeholder: "otel_logs", defaultValue: "otel_logs" },
		{ key: "metricsTable", label: "Metrics table", kind: "text", group: "settings", placeholder: "otel_metrics", defaultValue: "otel_metrics" },
		{ key: "query", label: messages.DB_CONFIG_FIELD_QUERY_PARAMS, kind: "text", group: "settings", placeholder: "a=b&c=d" },
		{ key: "password", label: messages.DB_CONFIG_FIELD_PASSWORD, kind: "password", group: "credentials", placeholder: "*******" },
	], [messages]);
	const [isDefault, setIsDefault] = useState(!!source?.isDefault);
	const [values, setValues] = useState<Record<string, string | boolean>>({});
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		fetch("/api/project/environment")
			.then((response) => response.ok ? response.json() : { environments: [] })
			.then((body) => setEnvironments(Array.from(new Set(["production", ...(body.environments || []).map((item: { name: string }) => item.name), environment]))))
			.catch(() => undefined);
	}, [environment]);

	const fields = useMemo(
		() => type === "clickhouse" ? clickHouseFields : fieldsForType(descriptors, type),
		[clickHouseFields, descriptors, type]
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
		for (const f of fields) {
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
	}, [fields, source]);

	const settingsFields = fields.filter(
		(f) => f.group === "settings" && f.key !== "authType" && isFieldVisible(f, values)
	);
	// authType is stored in settings JSON but shown with secrets under Authentication.
	const authenticationFields = fields.filter(
		(f) =>
			(f.key === "authType" || f.group === "credentials") &&
			isFieldVisible(f, { ...values })
	);

	const submit = async () => {
		if (!name.trim()) {
			toast.error(messages.TELEMETRY_SOURCE_NAME_REQUIRED);
			return;
		}
		const settings: Record<string, unknown> = {};
		for (const f of fields) {
			if (f.group === "settings" && isFieldVisible(f, values)) {
				settings[f.key] = values[f.key];
			}
		}
		const credentials: Record<string, string> = {};
		for (const f of fields) {
			if (f.group !== "credentials" || !isFieldVisible(f, values)) continue;
			const v = values[f.key];
			if (typeof v === "string" && v.trim() !== "") credentials[f.key] = v;
		}

		setSaving(true);
		toast.loading(messages.DATA_SOURCE_SAVED, { id: "ds-save" });
		try {
			if (type === "clickhouse") {
				const payload: Record<string, unknown> = {
					type: "clickhouse",
					category: "datasource",
					name: name.trim(),
					environment: environment.trim().toLowerCase() || "production",
					settings,
				};
				if (Object.keys(credentials).length) payload.credentials = credentials;
				await jsonFetch("/api/connectors", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				posthog?.capture(
					CLIENT_EVENTS.CONNECTOR_CREATE_SUCCESS,
					connectorCreateEventProps({
						type: "clickhouse",
						environment,
					})
				);
				toast.success(messages.DATA_SOURCE_SAVED, { id: "ds-save" });
				onSaved();
				return;
			}
			const payload: Record<string, unknown> = {
				name: name.trim(),
				environment: environment.trim().toLowerCase() || "production",
				settings,
				isDefault,
			};
			if (Object.keys(credentials).length) payload.credentials = credentials;
			if (isEdit) {
				await jsonFetch(`/api/connectors/${source!.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
			} else {
				if (!type) {
					toast.error(messages.TELEMETRY_SOURCE_TYPE_UNKNOWN(""));
					return;
				}
				payload.type = type;
				await jsonFetch("/api/connectors", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				posthog?.capture(
					CLIENT_EVENTS.CONNECTOR_CREATE_SUCCESS,
					connectorCreateEventProps({
						type,
						environment,
					})
				);
			}
			toast.success(messages.DATA_SOURCE_SAVED, { id: "ds-save" });
			onSaved();
		} catch (e: any) {
			if (!isEdit) {
				posthog?.capture(
					CLIENT_EVENTS.CONNECTOR_CREATE_FAILURE,
					connectorCreateEventProps({
						type: type || "unknown",
						environment,
					})
				);
			}
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
								<Select
									value={type}
									onValueChange={(nextType) => {
										setType(nextType);
									}}
									disabled={isEdit}
								>
				<SelectTrigger className="h-auto min-h-14 items-center gap-2 overflow-hidden border-stone-300 bg-white py-2.5 text-left text-stone-950 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:line-clamp-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50">
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
				<SelectContent className="grid max-h-96 min-w-[var(--radix-select-trigger-width)] grid-cols-2 items-stretch gap-2 p-2 sm:min-w-[680px]">
									{descriptors.map((d) => (
						<SelectItem key={d.type} value={d.type} className="min-h-[72px] items-start py-2 pl-2 pr-8">
							<div className="flex items-start gap-3">
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
							placeholder="production-traces"
								className="bg-white dark:bg-stone-900"
								/>
							</div>
							<div className="space-y-1.5">
						<Label className="text-xs">{messages.CONNECTOR_ENVIRONMENT}</Label>
						<Select value={environment} onValueChange={setEnvironment}>
							<SelectTrigger className="border-stone-300 bg-white text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50"><SelectValue placeholder={messages.CONNECTOR_ENVIRONMENT_PLACEHOLDER} /></SelectTrigger>
							<SelectContent>{environments.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
						</Select>
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

					{authenticationFields.length > 0 && (
						<section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
							<div>
								<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">
									{fields.some((f) => f.key === "authType")
										? messages.DATA_SOURCE_AUTHENTICATION_SECTION
										: messages.DATA_SOURCE_CREDENTIALS_TITLE}
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
							<div className="grid gap-3 sm:grid-cols-2">{authenticationFields.map((f) => (
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
