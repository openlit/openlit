"use client";

import Image from "next/image";
import { BookOpen, ExternalLink, Pencil, Settings2, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DatabaseConfig, DatabaseConfigWithActive } from "@/constants/dbConfig";
import {
	deleteDatabaseConfig,
	fetchDatabaseConfigList,
} from "@/helpers/client/database-config";
import {
	getDatabaseConfigList,
} from "@/selectors/database-config";
import { getCurrentProjectEnvironment } from "@/selectors/project";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { isNil } from "lodash";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";

const CLICKHOUSE_SIGNALS = ["traces", "logs", "metrics", "intelligence"] as const;

function ModifyDatabaseConfig({
	dbConfig,
	canCreate = true,
	canUpdate = true,
	onSaved,
	onClose,
}: {
	dbConfig?: DatabaseConfigWithActive;
	canCreate?: boolean;
	canUpdate?: boolean;
	onSaved?: () => void;
	onClose?: () => void;
}) {
	const posthog = usePostHog();
	const selectedEnvironment = useRootStore(getCurrentProjectEnvironment) || "production";
	const { fireRequest, isLoading } = useFetchWrapper();
	const messages = getMessage();
	const isEdit = !!dbConfig?.id;
	const [name, setName] = useState(dbConfig?.name || "");
	const [environment, setEnvironment] = useState(dbConfig?.environment || selectedEnvironment);
	const [username, setUsername] = useState(dbConfig?.username || "");
	const [password, setPassword] = useState("");
	const [host, setHost] = useState(dbConfig?.host || "");
	const [port, setPort] = useState(dbConfig?.port || "");
	const [database, setDatabase] = useState(dbConfig?.database || "");
	const [query, setQuery] = useState(dbConfig?.query || "");
	const [testing, setTesting] = useState(false);
	const [environments, setEnvironments] = useState<string[]>(
		["production", dbConfig?.environment || selectedEnvironment].filter(
			(value, index, values) => values.indexOf(value) === index
		)
	);
	const setupGuide = messages.DATA_SOURCE_SETUP_GUIDES.clickhouse;

	useEffect(() => {
		fetch("/api/project/environment")
			.then((response) => response.ok ? response.json() : { environments: [] })
			.then((body) => setEnvironments(Array.from(new Set(["production", ...(body.environments || []).map((item: { name: string }) => item.name), environment]))))
			.catch(() => undefined);
	}, [environment]);

	const formFieldsDisabled = isEdit
		? !canUpdate || !dbConfig?.permissions?.canEdit
		: !canCreate;
	const isAllowedToSubmit = isEdit
		? canUpdate && !!dbConfig?.permissions?.canEdit
		: canCreate;

	const save = useCallback(() => {
		if (!isAllowedToSubmit) return;
		toast.loading(messages.MODIFYING_DB_CONFIG, {
			id: "db-config-details",
		});

		const payload: DatabaseConfig = {
			id: dbConfig?.id || "",
			name,
			environment,
			username,
			host,
			port,
			database,
			query,
		};

		if (password) {
			payload.password = password;
		}

		fireRequest({
			body: JSON.stringify(payload),
			requestType: "POST",
			url: "/api/db-config",
			responseDataKey: "data",
			successCb: () => {
				fetchDatabaseConfigList((data: any[]) => {
					posthog?.capture(CLIENT_EVENTS.DB_CONFIG_LIST, {
						count: data.length,
					});
				});
				toast.success(messages.DB_CONFIG_UPDATED, {
					id: "db-config-details",
				});
				onSaved?.();
				posthog?.capture(
					payload.id
						? CLIENT_EVENTS.DB_CONFIG_UPDATE_SUCCESS
						: CLIENT_EVENTS.DB_CONFIG_ADD_SUCCESS
				);
			},
			failureCb: (err?: string) => {
				toast.error(err || messages.DB_CONFIG_UPDATE_FAILED, {
					id: "db-config-details",
				});
				posthog?.capture(
					payload.id
						? CLIENT_EVENTS.DB_CONFIG_UPDATE_FAILURE
						: CLIENT_EVENTS.DB_CONFIG_ADD_FAILURE
				);
			},
		});
	}, [
		database,
		dbConfig?.id,
		environment,
		fireRequest,
		host,
		isAllowedToSubmit,
		messages,
		name,
		onSaved,
		password,
		port,
		posthog,
		query,
		username,
	]);

	const testConnection = async () => {
		if (!isEdit) {
			toast.error(messages.DATA_SOURCE_TEST_UNSAVED, { id: "db-config-test" });
			return;
		}
		setTesting(true);
		toast.loading(messages.DATA_SOURCE_TESTING, { id: "db-config-test" });
		try {
			const response = await fetch("/api/clickhouse", { method: "POST" });
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body?.err) throw new Error(body?.err || messages.DATA_SOURCE_SAVE_FAILED);
			toast.success(messages.DATA_SOURCE_TEST_OK, { id: "db-config-test" });
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : messages.DATA_SOURCE_SAVE_FAILED,
				{ id: "db-config-test" }
			);
		} finally {
			setTesting(false);
		}
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{isEdit ? messages.DATA_SOURCE_DETAILS : messages.DATA_SOURCE_ADD}
				</DialogTitle>
				<DialogDescription>
					{isEdit && !dbConfig?.permissions?.canEdit
						? messages.DB_CONFIG_EDIT_PERMISSION_REQUIRED
						: messages.CLICKHOUSE_CONNECTOR_DESCRIPTION}
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
						<div className="flex min-h-14 items-center gap-2.5 overflow-hidden rounded-md border border-stone-300 bg-white px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900">
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950">
								<Image src="/images/connectors/clickhouse.svg" alt="" width={20} height={20} className="h-5 w-5 object-contain" />
							</div>
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">{messages.DATA_SOURCE_BUILTIN_TITLE}</p>
								<p className="truncate text-[11px] text-muted-foreground">{messages.CLICKHOUSE_CONNECTOR_DESCRIPTION}</p>
							</div>
						</div>
						{isEdit && <p className="text-[11px] text-muted-foreground">{messages.DATA_SOURCE_TYPE_LOCKED}</p>}
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-1.5">
						<span className="mr-1 text-[11px] text-muted-foreground">{messages.DATA_SOURCE_SIGNALS_SECTION}:</span>
						{CLICKHOUSE_SIGNALS.map((sig) => (
							<Badge key={sig} variant="secondary" className="text-[10px]">{sig}</Badge>
						))}
					</div>
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
								onChange={(event) => setName(event.target.value)}
								placeholder="production-traces"
								disabled={formFieldsDisabled}
								className="bg-white dark:bg-stone-900"
							/>
						</div>
						<div className="space-y-1.5">
							<Label className="text-xs">{messages.CONNECTOR_ENVIRONMENT}</Label>
							<Select value={environment} onValueChange={setEnvironment} disabled={formFieldsDisabled}>
								<SelectTrigger className="border-stone-300 bg-white text-stone-950 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-50">
									<SelectValue placeholder={messages.CONNECTOR_ENVIRONMENT_PLACEHOLDER} />
								</SelectTrigger>
								<SelectContent>
									{environments.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
								</SelectContent>
							</Select>
						</div>
					</div>
				</section>

				<section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
					<div>
						<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.DATA_SOURCE_SETTINGS_SECTION}</p>
						<p className="mt-0.5 text-[11px] text-muted-foreground">{messages.DATA_SOURCE_SETTINGS_SECTION_DESCRIPTION}</p>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label className="text-xs">{messages.DB_CONFIG_FIELD_HOST}</Label>
							<Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="127.0.0.1" disabled={formFieldsDisabled} className="bg-white dark:bg-stone-900" />
						</div>
						<div className="space-y-1.5">
							<Label className="text-xs">{messages.DB_CONFIG_FIELD_PORT}</Label>
							<Input value={port} onChange={(event) => setPort(event.target.value)} placeholder="8123" disabled={formFieldsDisabled} className="bg-white dark:bg-stone-900" />
						</div>
						<div className="space-y-1.5">
							<Label className="text-xs">{messages.DB_CONFIG_FIELD_DATABASE}</Label>
							<Input value={database} onChange={(event) => setDatabase(event.target.value)} placeholder="default" disabled={formFieldsDisabled} className="bg-white dark:bg-stone-900" />
						</div>
						<div className="space-y-1.5">
							<Label className="text-xs">{messages.DB_CONFIG_FIELD_QUERY_PARAMS}</Label>
							<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="a=b&c=d" disabled={formFieldsDisabled} className="bg-white dark:bg-stone-900" />
						</div>
					</div>
				</section>

				<section className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-800">
					<div>
						<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">{messages.DATA_SOURCE_CREDENTIALS_TITLE}</p>
						<p className="text-xs text-muted-foreground">
							{isEdit ? messages.DATA_SOURCE_CREDENTIALS_SET : messages.DATA_SOURCE_CREDENTIALS_HELP}
						</p>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label className="text-xs">{messages.DB_CONFIG_FIELD_USERNAME}</Label>
							<Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username" disabled={formFieldsDisabled} className="bg-white dark:bg-stone-900" />
						</div>
						<div className="space-y-1.5">
							<Label className="text-xs">{messages.DB_CONFIG_FIELD_PASSWORD}</Label>
							<Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="*******" disabled={formFieldsDisabled} className="bg-white dark:bg-stone-900" />
						</div>
					</div>
				</section>
			</div>

			<DialogFooter className="gap-2 sm:justify-between">
				<Button
					variant="outline"
					onClick={() => void testConnection()}
					disabled={isLoading || testing || !isEdit}
					title={!isEdit ? messages.DATA_SOURCE_TEST_UNSAVED : undefined}
				>
					<Wifi className="mr-1.5 h-3.5 w-3.5" />
					{testing ? messages.DATA_SOURCE_TESTING : messages.DATA_SOURCE_TEST}
				</Button>
				<div className="flex gap-2">
					<Button variant="outline" onClick={onClose} disabled={isLoading || testing}>
						{messages.CANCEL}
					</Button>
					<Button onClick={save} disabled={isLoading || testing || !isAllowedToSubmit}>
						{messages.SAVE}
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}
function DatabaseList({
	dbConfigs,
	canCreate,
	canUpdate,
	canDelete,
	canShare,
	hideHeader,
	openNew,
	onOpenNewHandled,
	hideEmpty,
	hideList,
	editing: controlledEditing,
	onEditingChange,
	onConfigSaved,
}: {
	dbConfigs: DatabaseConfigWithActive[];
	canCreate: boolean;
	canUpdate: boolean;
	canDelete: boolean;
	canShare: boolean;
	hideHeader?: boolean;
	openNew?: boolean;
	onOpenNewHandled?: () => void;
	hideEmpty?: boolean;
	hideList?: boolean;
	editing?: DatabaseConfigWithActive | "new" | null;
	onEditingChange?: (next: DatabaseConfigWithActive | "new" | null) => void;
	onConfigSaved?: () => void;
}) {
	const messages = getMessage();
	const selectedEnvironment = useRootStore(getCurrentProjectEnvironment) || "production";
	const [internalEditing, setInternalEditing] = useState<DatabaseConfigWithActive | "new" | null>(null);
	const editing = controlledEditing !== undefined ? controlledEditing : internalEditing;
	const setEditing = onEditingChange || setInternalEditing;
	const [testingId, setTestingId] = useState<string | null>(null);
	const visibleConfigs = useMemo(
		() => dbConfigs.filter((config) => (config.environment || "production").toLowerCase() === selectedEnvironment.toLowerCase()),
		[dbConfigs, selectedEnvironment]
	);
	useEffect(() => {
		if (openNew) {
			setEditing(visibleConfigs[0] || "new");
			onOpenNewHandled?.();
		}
	}, [onOpenNewHandled, openNew, visibleConfigs.length]);

	const remove = (config: DatabaseConfigWithActive) => {
		if (!canDelete || !config.permissions?.canDelete) return;
		if (window.confirm(messages.DELETE_DATABASE_CONFIG_CONFIRMATION)) void deleteDatabaseConfig(config.id);
	};

	const testConnection = async (config: DatabaseConfigWithActive) => {
		setTestingId(config.id);
		toast.loading(messages.DATA_SOURCE_TESTING, { id: "db-config-test" });
		try {
			const response = await fetch("/api/clickhouse", { method: "POST" });
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body?.err) throw new Error(body?.err || messages.DATA_SOURCE_SAVE_FAILED);
			toast.success(messages.DATA_SOURCE_TEST_OK, { id: "db-config-test" });
		} catch (error: any) {
			toast.error(error?.message || messages.DATA_SOURCE_SAVE_FAILED, { id: "db-config-test" });
		} finally {
			setTestingId(null);
		}
	};

	const dialog = editing ? (
		<Dialog open onOpenChange={(open) => !open && setEditing(null)}>
			<DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[92vh] overflow-y-auto border-stone-200 bg-white text-stone-950 shadow-2xl dark:border-stone-800 dark:bg-stone-950 dark:text-stone-50 sm:max-w-4xl">
				<ModifyDatabaseConfig
					dbConfig={editing === "new" ? undefined : editing}
					canCreate={canCreate}
					canUpdate={canUpdate}
					onClose={() => setEditing(null)}
					onSaved={() => {
						setEditing(null);
						onConfigSaved?.();
					}}
				/>
			</DialogContent>
		</Dialog>
	) : null;

	if (hideList) return dialog;

	return (
		<div className={hideHeader ? "relative contents" : "relative w-full p-4"}>
			{!hideHeader && <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">ClickHouse targets for {selectedEnvironment}</p>
					<p className="mt-1 text-[11px] text-muted-foreground">Each target is a ClickHouse connector for this project environment.</p>
				</div>
				{canCreate && visibleConfigs.length === 0 && <Button size="sm" onClick={() => setEditing("new")}>+ {messages.ADD_DATABASE_CONFIG}</Button>}
			</div>}
			{visibleConfigs.length === 0 && hideEmpty ? null : visibleConfigs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
					<p className="text-sm font-medium text-stone-900 dark:text-stone-100">{messages.DB_CONFIG_EMPTY_TITLE}</p>
					<p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{messages.DB_CONFIG_EMPTY_DESCRIPTION}</p>
					{canCreate && <Button size="sm" className="mt-4" onClick={() => setEditing("new")}>{messages.ADD_DATABASE_CONFIG}</Button>}
				</div>
			) : (
				<div className={hideHeader ? "contents" : "grid gap-3 md:grid-cols-2"}>
					{visibleConfigs.map((config) => (
						<div key={config.id} className="flex min-h-[168px] flex-col justify-between rounded-lg border border-stone-200 bg-stone-50/70 p-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-primary/50">
							<div className="flex items-start gap-3">
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950"><Image src="/images/connectors/clickhouse.svg" alt="" width={24} height={24} className="h-6 w-6 object-contain" /></div>
								<div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-stone-950 dark:text-stone-50">{config.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">ClickHouse connector</p></div>
							</div>
							<p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">Telemetry, dashboards, and derived features for this project environment.</p>
							<div className="mt-2 flex flex-wrap gap-1"><Badge variant="secondary" className="text-[10px]">{config.environment || "production"}</Badge><Badge variant="outline" className="max-w-full truncate text-[10px]">{config.host}:{config.port}</Badge></div>
							<div className="mt-3 flex items-center justify-end gap-1 border-t border-stone-200 pt-2 dark:border-stone-800"><Button size="sm" variant="ghost" onClick={() => testConnection(config)} disabled={testingId === config.id}><Wifi className="mr-1 h-3.5 w-3.5" />{messages.DATA_SOURCE_TEST}</Button><Button size="icon" variant="ghost" onClick={() => setEditing(config)} disabled={!canUpdate || !config.permissions?.canEdit} aria-label="Edit connector"><Pencil className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" onClick={() => remove(config)} disabled={!canDelete || !config.permissions?.canDelete} aria-label="Delete connector"><Trash2 className="h-3.5 w-3.5 text-error" /></Button></div>
						</div>
					))}
				</div>
			)}
			{dialog}
		</div>
	);
}

export default function Database({
	canCreate = true,
	canUpdate = true,
	canDelete = true,
	canShare = true,
	hideHeader = false,
	openNew = false,
	onOpenNewHandled,
	hideEmpty = false,
	hideList = false,
	editing,
	onEditingChange,
	onConfigSaved,
}: {
	canCreate?: boolean;
	canUpdate?: boolean;
	canDelete?: boolean;
	canShare?: boolean;
	hideHeader?: boolean;
	openNew?: boolean;
	onOpenNewHandled?: () => void;
	hideEmpty?: boolean;
	hideList?: boolean;
	editing?: DatabaseConfigWithActive | "new" | null;
	onEditingChange?: (next: DatabaseConfigWithActive | "new" | null) => void;
	onConfigSaved?: () => void;
}) {
	const databaseList = useRootStore(getDatabaseConfigList);

	if (isNil(databaseList) && hideList) {
		return (
			<DatabaseList
				dbConfigs={[]}
				canCreate={canCreate}
				canUpdate={canUpdate}
				canDelete={canDelete}
				canShare={canShare}
				hideHeader
				hideEmpty
				hideList
				editing={editing}
				onEditingChange={onEditingChange}
				onConfigSaved={onConfigSaved}
			/>
		);
	}

	return isNil(databaseList) ? (
		<div className={hideHeader ? "contents" : "p-4"}>
			<div className="flex min-h-[190px] flex-col gap-4 rounded-lg border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
				<div className="flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-md bg-stone-200 dark:bg-stone-800" /><div className="space-y-2"><div className="h-3 w-32 animate-pulse rounded bg-stone-200 dark:bg-stone-800" /><div className="h-2.5 w-24 animate-pulse rounded bg-stone-200 dark:bg-stone-800" /></div></div>
				<div className="space-y-2"><div className="h-2.5 w-full animate-pulse rounded bg-stone-200 dark:bg-stone-800" /><div className="h-2.5 w-3/4 animate-pulse rounded bg-stone-200 dark:bg-stone-800" /></div>
				<div className="mt-auto h-8 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
			</div>
		</div>
	) : (
		<DatabaseList
			dbConfigs={(databaseList as DatabaseConfigWithActive[]) || []}
			canCreate={canCreate}
			canUpdate={canUpdate}
			canDelete={canDelete}
			canShare={canShare}
			hideHeader={hideHeader}
			openNew={openNew}
			onOpenNewHandled={onOpenNewHandled}
			hideEmpty={hideEmpty}
			hideList={hideList}
			editing={editing}
			onEditingChange={onEditingChange}
			onConfigSaved={onConfigSaved}
		/>
	);
}
