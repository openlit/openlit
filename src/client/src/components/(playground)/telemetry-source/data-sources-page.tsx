"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	Database,
	Lock,
	Plus,
	Layers,
	Trash2,
	Wifi,
	Pencil,
	ShieldCheck,
} from "lucide-react";
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

type Signal = "traces" | "logs" | "metrics";
const SIGNALS: Signal[] = ["traces", "logs", "metrics"];
const BUILTIN = "builtin";

interface TypeDescriptor {
	type: string;
	displayName: string;
	declaredSignals: Signal[];
	correlation?: { crossSignal: boolean; keys: string[] };
}

interface SourceRow {
	id: string;
	name: string;
	type: string;
	signals: string;
	settings: string;
	isDefault: boolean;
	hasSecret?: boolean;
}

interface BindingRow {
	signal: string;
	sourceId: string;
	sourceName: string | null;
	sourceType: string | null;
}

interface StackTemplate {
	template: string;
	displayName: string;
	slots: { key: string; type: string; signal: Signal }[];
}

type FieldKind = "text" | "url" | "password" | "switch" | "select";
interface FieldDef {
	key: string;
	label: string;
	kind: FieldKind;
	group: "settings" | "credentials";
	placeholder?: string;
	options?: { value: string; label: string }[];
	defaultValue?: string | boolean;
}

function typeFields(type: string): FieldDef[] {
	const messages = getMessage();
	const url: FieldDef = {
		key: "url",
		label: messages.DATA_SOURCE_FIELD_ENDPOINT,
		kind: "url",
		group: "settings",
		placeholder: "https://tempo.example.com",
	};
	const allowHttp: FieldDef = {
		key: "allowHttp",
		label: messages.DATA_SOURCE_FIELD_ALLOW_HTTP,
		kind: "switch",
		group: "settings",
		defaultValue: true,
	};
	const token: FieldDef = {
		key: "token",
		label: messages.DATA_SOURCE_FIELD_TOKEN,
		kind: "password",
		group: "credentials",
	};
	const username: FieldDef = {
		key: "username",
		label: messages.DATA_SOURCE_FIELD_USERNAME,
		kind: "text",
		group: "credentials",
	};
	const password: FieldDef = {
		key: "password",
		label: messages.DATA_SOURCE_FIELD_PASSWORD,
		kind: "password",
		group: "credentials",
	};
	const tenant: FieldDef = {
		key: "tenant",
		label: messages.DATA_SOURCE_FIELD_TENANT,
		kind: "text",
		group: "credentials",
	};
	const httpAuth = [token, username, password];

	switch (type) {
		case "datadog":
			return [
				{
					key: "site",
					label: messages.DATA_SOURCE_FIELD_SITE,
					kind: "text",
					group: "settings",
					placeholder: "datadoghq.com",
					defaultValue: "datadoghq.com",
				},
				{
					key: "apiKey",
					label: messages.DATA_SOURCE_FIELD_API_KEY,
					kind: "password",
					group: "credentials",
				},
				{
					key: "appKey",
					label: messages.DATA_SOURCE_FIELD_APP_KEY,
					kind: "password",
					group: "credentials",
				},
			];
		case "newrelic":
			return [
				{
					key: "region",
					label: messages.DATA_SOURCE_FIELD_REGION,
					kind: "select",
					group: "settings",
					defaultValue: "US",
					options: [
						{ value: "US", label: "US" },
						{ value: "EU", label: "EU" },
					],
				},
				{
					key: "accountId",
					label: messages.DATA_SOURCE_FIELD_ACCOUNT_ID,
					kind: "text",
					group: "settings",
					placeholder: "1234567",
				},
				{
					key: "apiKey",
					label: messages.DATA_SOURCE_FIELD_API_KEY,
					kind: "password",
					group: "credentials",
				},
			];
		case "loki":
		case "prometheus":
		case "mimir":
		case "victorialogs":
		case "victoriametrics":
			return [url, allowHttp, ...httpAuth, tenant];
		case "tempo":
		case "jaeger":
		default:
			return [url, allowHttp, ...httpAuth];
	}
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
}: {
	projectId?: string;
}) {
	const messages = getMessage();
	const [loading, setLoading] = useState(true);
	const [sources, setSources] = useState<SourceRow[]>([]);
	const [descriptors, setDescriptors] = useState<TypeDescriptor[]>([]);
	const [bindings, setBindings] = useState<BindingRow[]>([]);
	const [templates, setTemplates] = useState<StackTemplate[]>([]);
	const [editing, setEditing] = useState<SourceRow | "new" | null>(null);
	const [stackOpen, setStackOpen] = useState(false);
	const [testingId, setTestingId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [list, binds, stacks] = await Promise.all([
				jsonFetch("/api/telemetry-source"),
				jsonFetch("/api/telemetry-source/binding"),
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
	}, [messages.DATA_SOURCE_LOAD_FAILED]);

	useEffect(() => {
		load();
	}, [load, projectId]);

	const bindingForSignal = useCallback(
		(signal: Signal) => bindings.find((b) => b.signal === signal),
		[bindings]
	);

	const setBinding = async (signal: Signal, sourceId: string) => {
		toast.loading(messages.DATA_SOURCE_BINDING_SAVED, { id: "ds-bind" });
		try {
			if (sourceId === BUILTIN) {
				await jsonFetch(
					`/api/telemetry-source/binding?signal=${encodeURIComponent(signal)}`,
					{ method: "DELETE" }
				);
			} else {
				await jsonFetch("/api/telemetry-source/binding", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ signal, sourceId }),
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
				toast.error(health?.message || messages.DATA_SOURCE_SAVE_FAILED, {
					id: "ds-test",
				});
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
		<div className="flex h-full w-full flex-col gap-4 overflow-auto p-4 text-stone-700 dark:text-stone-300">
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
						const value = binding?.sourceId || BUILTIN;
						const options = sources.filter((s) =>
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
										<SelectItem value={BUILTIN}>
											{messages.DATA_SOURCE_SIGNAL_BUILTIN_OPTION}
										</SelectItem>
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
				) : sources.length === 0 ? (
					<div className="flex flex-col items-center gap-1 py-10 text-center">
						<h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
							{messages.DATA_SOURCE_EMPTY_TITLE}
						</h3>
						<p className="max-w-md text-sm text-muted-foreground">
							{messages.DATA_SOURCE_EMPTY_DESCRIPTION}
						</p>
					</div>
				) : (
					<div className="divide-y divide-stone-200 dark:divide-stone-800">
						{sources.map((s) => (
							<div
								key={s.id}
								className="flex flex-wrap items-center justify-between gap-2 py-2.5"
							>
								<div className="flex flex-col gap-1">
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-stone-950 dark:text-stone-50">
											{s.name}
										</span>
										<Badge variant="outline" className="text-[10px]">
											{s.type}
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
						))}
					</div>
				)}
			</section>

			{editing && (
				<SourceFormDialog
					source={editing === "new" ? null : editing}
					descriptors={descriptors}
					onClose={() => setEditing(null)}
					onSaved={async () => {
						setEditing(null);
						await load();
					}}
				/>
			)}

			{stackOpen && (
				<StackDialog
					templates={templates}
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

function SourceFormDialog({
	source,
	descriptors,
	onClose,
	onSaved,
}: {
	source: SourceRow | null;
	descriptors: TypeDescriptor[];
	onClose: () => void;
	onSaved: () => void;
}) {
	const messages = getMessage();
	const isEdit = !!source;
	const [name, setName] = useState(source?.name || "");
	const [type, setType] = useState(source?.type || descriptors[0]?.type || "");
	const [isDefault, setIsDefault] = useState(!!source?.isDefault);
	const [values, setValues] = useState<Record<string, string | boolean>>({});
	const [saving, setSaving] = useState(false);

	const fields = useMemo(() => typeFields(type), [type]);

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
		for (const f of typeFields(type)) {
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
	}, [type, source]);

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

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{isEdit ? messages.DATA_SOURCE_EDIT : messages.DATA_SOURCE_ADD}
					</DialogTitle>
					<DialogDescription>
						{messages.PROJECT_DATA_SOURCES_DESCRIPTION}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
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
						<Label className="text-xs">{messages.DATA_SOURCE_FIELD_TYPE}</Label>
						<Select value={type} onValueChange={setType} disabled={isEdit}>
							<SelectTrigger className="bg-white dark:bg-stone-900">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{descriptors.map((d) => (
									<SelectItem key={d.type} value={d.type}>
										{d.displayName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{activeDescriptor && (
							<div className="flex flex-wrap gap-1 pt-0.5">
								{activeDescriptor.declaredSignals.map((sig) => (
									<Badge key={sig} variant="secondary" className="text-[10px]">
										{sig}
									</Badge>
								))}
							</div>
						)}
					</div>

					{settingsFields.map((f) => (
						<FieldInput
							key={f.key}
							field={f}
							value={values[f.key] ?? ""}
							onChange={(v) => setValues((p) => ({ ...p, [f.key]: v }))}
						/>
					))}

					{credentialFields.length > 0 && (
						<>
							<Separator />
							<div>
								<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">
									{messages.DATA_SOURCE_CREDENTIALS_TITLE}
								</p>
								<p className="text-xs text-muted-foreground">
									{isEdit && source?.hasSecret
										? messages.DATA_SOURCE_CREDENTIALS_SET
										: messages.DATA_SOURCE_CREDENTIALS_HELP}
								</p>
							</div>
							{credentialFields.map((f) => (
								<FieldInput
									key={f.key}
									field={f}
									value={values[f.key] ?? ""}
									onChange={(v) =>
										setValues((p) => ({ ...p, [f.key]: v }))
									}
								/>
							))}
						</>
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
	onClose,
	onSaved,
}: {
	templates: StackTemplate[];
	onClose: () => void;
	onSaved: () => void;
}) {
	const messages = getMessage();
	const [templateKey, setTemplateKey] = useState(templates[0]?.template || "");
	const [name, setName] = useState("");
	const [slotValues, setSlotValues] = useState<
		Record<string, { url: string; allowHttp: boolean; token: string }>
	>({});
	const [saving, setSaving] = useState(false);

	const template = templates.find((t) => t.template === templateKey);

	useEffect(() => {
		const next: Record<
			string,
			{ url: string; allowHttp: boolean; token: string }
		> = {};
		for (const slot of template?.slots || []) {
			next[slot.key] = { url: "", allowHttp: true, token: "" };
		}
		setSlotValues(next);
	}, [templateKey, template]);

	const submit = async () => {
		if (!name.trim()) {
			toast.error(messages.TELEMETRY_SOURCE_NAME_REQUIRED);
			return;
		}
		const members = (template?.slots || []).map((slot) => {
			const v = slotValues[slot.key] || { url: "", allowHttp: true, token: "" };
			const credentials: Record<string, string> = {};
			if (v.token.trim()) credentials.token = v.token.trim();
			return {
				type: slot.type,
				settings: { url: v.url.trim(), allowHttp: v.allowHttp },
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
				body: JSON.stringify({ name: name.trim(), members, bind: true }),
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
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{messages.DATA_SOURCE_STACK_TITLE}</DialogTitle>
					<DialogDescription>
						{messages.DATA_SOURCE_STACK_DESCRIPTION}
					</DialogDescription>
				</DialogHeader>

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

					<div className="space-y-1.5">
						<Label className="text-xs">{messages.DATA_SOURCE_FIELD_TYPE}</Label>
						<Select value={templateKey} onValueChange={setTemplateKey}>
							<SelectTrigger className="bg-white dark:bg-stone-900">
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

					<Separator />

					{(template?.slots || []).map((slot) => {
						const v = slotValues[slot.key] || {
							url: "",
							allowHttp: true,
							token: "",
						};
						return (
							<div
								key={slot.key}
								className="space-y-2 rounded-md border border-stone-200 p-3 dark:border-stone-800"
							>
								<div className="flex items-center gap-2">
									<Badge variant="outline" className="text-[10px]">
										{slot.type}
									</Badge>
									<Badge variant="secondary" className="text-[10px]">
										{slot.signal}
									</Badge>
								</div>
								<Input
									value={v.url}
									placeholder="https://tempo.example.com"
									onChange={(e) =>
										setSlotValues((p) => ({
											...p,
											[slot.key]: { ...v, url: e.target.value },
										}))
									}
									className="bg-white dark:bg-stone-900"
								/>
								<Input
									type="password"
									value={v.token}
									placeholder={messages.DATA_SOURCE_FIELD_TOKEN}
									onChange={(e) =>
										setSlotValues((p) => ({
											...p,
											[slot.key]: { ...v, token: e.target.value },
										}))
									}
									className="bg-white dark:bg-stone-900"
								/>
								<div className="flex items-center justify-between">
									<Label className="text-xs">
										{messages.DATA_SOURCE_FIELD_ALLOW_HTTP}
									</Label>
									<Switch
										checked={v.allowHttp}
										onCheckedChange={(c) =>
											setSlotValues((p) => ({
												...p,
												[slot.key]: { ...v, allowHttp: c },
											}))
										}
									/>
								</div>
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
