"use client";

import FormBuilder from "@/components/common/form-builder";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DatabaseConfig, DatabaseConfigWithActive } from "@/constants/dbConfig";
import {
	changeActiveDatabaseConfig,
	deleteDatabaseConfig,
	fetchDatabaseConfigList,
} from "@/helpers/client/database-config";
import {
	getDatabaseConfigList,
	getDatabaseConfigListIsLoading,
} from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { isNil } from "lodash";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { FormBuilderEvent } from "@/types/form";
import { PRIMARY_BACKGROUND } from "@/constants/common-classes";
import getMessage from "@/constants/messages";

function ModifyDatabaseConfig({
	dbConfig,
	canCreate = true,
	canUpdate = true,
	onSaved,
}: {
	dbConfig?: DatabaseConfigWithActive;
	canCreate?: boolean;
	canUpdate?: boolean;
	onSaved?: () => void;
}) {
	const posthog = usePostHog();
	const searchParams = useSearchParams();
	const selectedEnvironment = searchParams.get("environment") || "production";
	const { fireRequest, isLoading } = useFetchWrapper();
	const messages = getMessage();
	const [environments, setEnvironments] = useState<string[]>([
		"production",
		dbConfig?.environment || selectedEnvironment,
	].filter((value, index, values) => values.indexOf(value) === index));

	useEffect(() => {
		fetch("/api/project/environment")
			.then((response) => response.ok ? response.json() : { environments: [] })
			.then((body) => setEnvironments(Array.from(new Set(["production", ...(body.environments || []).map((item: { name: string }) => item.name)]))))
			.catch(() => undefined);
	}, []);

	const modifyDetails: FormBuilderEvent = useCallback(
		(event) => {
			event.preventDefault();
			const formElement = event.target as HTMLFormElement;

			toast.loading(messages.MODIFYING_DB_CONFIG, {
				id: "db-config-details",
			});

			const payload: DatabaseConfig = {
				id: dbConfig?.id || "",
				name: (formElement.name as any).value,
				environment: formElement.environment.value,
				username: formElement.username.value,
				host: formElement.host.value,
				port: formElement.port.value,
				database: formElement.database.value,
				query: formElement.query.value,
			};

			if (formElement.password.value) {
				payload.password = formElement.password.value;
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
					if (!dbConfig?.id) formElement.reset();
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
		},
		[dbConfig?.id, onSaved]
	);

	const formFieldsDisabled = dbConfig?.id
		? !canUpdate || !dbConfig.permissions?.canEdit
		: !canCreate;

	return (
		<FormBuilder
			cardClassName={`${PRIMARY_BACKGROUND} py-4 px-6 rounded-none`}
			fields={[
				{
					label: messages.DB_CONFIG_FIELD_CONFIG_NAME,
					inputKey: `${dbConfig?.id}-name`,
					fieldType: "INPUT",
					fieldTypeProps: {
						type: "text",
						name: "name",
						placeholder: "db-config",
						defaultValue: dbConfig?.name,
						disabled: formFieldsDisabled,
					},
				},
				{
					label: messages.DB_CONFIG_FIELD_ENVIRONMENT,
					inputKey: `${dbConfig?.id}-environment`,
					fieldType: "SELECT",
					fieldTypeProps: {
						name: "environment",
						placeholder: "production",
						options: environments.map((environment) => ({ value: environment, label: environment })),
						defaultValue: dbConfig?.environment || selectedEnvironment,
						disabled: formFieldsDisabled,
					},
				},
				{
					label: messages.DB_CONFIG_FIELD_USERNAME,
					fieldType: "INPUT",
					inputKey: `${dbConfig?.id}-username`,
					fieldTypeProps: {
						type: "text",
						name: "username",
						placeholder: "username",
						defaultValue: dbConfig?.username,
						disabled: formFieldsDisabled,
					},
				},
				{
					label: messages.DB_CONFIG_FIELD_PASSWORD,
					inputKey: `${dbConfig?.id}-password`,
					fieldType: "INPUT",
					fieldTypeProps: {
						type: "password",
						name: "password",
						placeholder: "*******",
						disabled: formFieldsDisabled,
					},
				},
				{
					label: messages.DB_CONFIG_FIELD_HOST,
					inputKey: `${dbConfig?.id}-host`,
					fieldType: "INPUT",
					fieldTypeProps: {
						type: "text",
						name: "host",
						placeholder: "127.0.0.1",
						defaultValue: dbConfig?.host,
						disabled: formFieldsDisabled,
					},
				},
				{
					label: messages.DB_CONFIG_FIELD_PORT,
					inputKey: `${dbConfig?.id}-port`,
					fieldType: "INPUT",
					fieldTypeProps: {
						type: "number",
						name: "port",
						placeholder: "8123",
						defaultValue: dbConfig?.port,
						disabled: formFieldsDisabled,
					},
				},
				{
					label: messages.DB_CONFIG_FIELD_DATABASE,
					inputKey: `${dbConfig?.id}-database`,
					fieldType: "INPUT",
					fieldTypeProps: {
						type: "text",
						name: "database",
						placeholder: "default",
						defaultValue: dbConfig?.database,
						disabled: formFieldsDisabled,
					},
				},
				{
					label: messages.DB_CONFIG_FIELD_QUERY_PARAMS,
					inputKey: `${dbConfig?.id}-query`,
					fieldType: "INPUT",
					fieldTypeProps: {
						type: "text",
						name: "query",
						placeholder: "a=b&c=d",
						defaultValue: dbConfig?.query,
						disabled: formFieldsDisabled,
					},
				},
			]}
			heading={
				dbConfig?.id
					? !dbConfig?.permissions?.canEdit
						? messages.CLICKHOUSE_CONNECTOR_EDIT_TITLE
						: messages.CLICKHOUSE_CONNECTOR_EDIT_TITLE
					: messages.CLICKHOUSE_CONNECTOR_ADD_TITLE
			}
			subHeading={
				!dbConfig?.id || dbConfig?.permissions?.canEdit
					? `${messages.CLICKHOUSE_CONNECTOR_DESCRIPTION} ${messages.CLICKHOUSE_CONNECTOR_INSTRUCTIONS}`
					: messages.DB_CONFIG_EDIT_PERMISSION_REQUIRED
			}
			subHeadingClass="text-error"
			isLoading={isLoading}
			onSubmit={modifyDetails}
			isAllowedToSubmit={
				dbConfig?.id
					? canUpdate && !!dbConfig.permissions?.canEdit
					: canCreate
			}
			submitButtonText={dbConfig?.id ? messages.UPDATE : messages.SAVE}
		/>
	);
}
function DatabaseList({
	dbConfigs,
	isLoadingList,
	canCreate,
	canSelect,
	canUpdate,
	canDelete,
	canShare,
	openNew,
	onOpenNewHandled,
}: {
	dbConfigs: DatabaseConfigWithActive[];
	isLoadingList: boolean;
	canCreate: boolean;
	canSelect: boolean;
	canUpdate: boolean;
	canDelete: boolean;
	canShare: boolean;
	openNew?: boolean;
	onOpenNewHandled?: () => void;
}) {
	const posthog = usePostHog();
	const messages = getMessage();
	const selectedEnvironment = useSearchParams().get("environment") || "production";
	const [editing, setEditing] = useState<DatabaseConfigWithActive | "new" | null>(null);
	const visibleConfigs = useMemo(
		() => dbConfigs.filter((config) => (config.environment || "production").toLowerCase() === selectedEnvironment.toLowerCase()),
		[dbConfigs, selectedEnvironment]
	);
	useEffect(() => {
		if (openNew) {
			if (visibleConfigs.length === 0) setEditing("new");
			onOpenNewHandled?.();
		}
	}, [onOpenNewHandled, openNew, visibleConfigs.length]);

	const setCurrent = (config: DatabaseConfigWithActive) => {
		if (!canSelect) return;
		toast.loading(messages.DB_CONFIG_SET_ACTIVE(config.name), { id: "db-config-current" });
		void changeActiveDatabaseConfig(config.id, () => posthog?.capture(CLIENT_EVENTS.DB_CONFIG_ACTION_CHANGE));
	};

	const remove = (config: DatabaseConfigWithActive) => {
		if (!canDelete || !config.permissions?.canDelete) return;
		if (window.confirm(messages.DELETE_DATABASE_CONFIG_CONFIRMATION)) void deleteDatabaseConfig(config.id);
	};

	return (
		<div className="relative w-full p-4">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div>
					<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">ClickHouse targets for {selectedEnvironment}</p>
					<p className="mt-1 text-[11px] text-muted-foreground">Each target is a ClickHouse connector for this project environment.</p>
				</div>
				{canCreate && visibleConfigs.length === 0 && <Button size="sm" onClick={() => setEditing("new")}>+ {messages.ADD_DATABASE_CONFIG}</Button>}
			</div>
			{visibleConfigs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
					<p className="text-sm font-medium text-stone-900 dark:text-stone-100">{messages.DB_CONFIG_EMPTY_TITLE}</p>
					<p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{messages.DB_CONFIG_EMPTY_DESCRIPTION}</p>
					{canCreate && <Button size="sm" className="mt-4" onClick={() => setEditing("new")}>{messages.ADD_DATABASE_CONFIG}</Button>}
				</div>
			) : (
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
					{visibleConfigs.map((config) => (
						<div key={config.id} className="flex min-h-[190px] flex-col rounded-lg border border-stone-200 bg-stone-50/70 p-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] dark:border-stone-800 dark:bg-stone-900/50 dark:hover:border-primary/50">
							<div className="flex items-start gap-3">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-950"><Image src="/images/connectors/clickhouse.svg" alt="" width={24} height={24} className="h-6 w-6 object-contain" /></div>
								<div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-medium text-stone-950 dark:text-stone-50">{config.name}</p>{config.isCurrent && <Badge className="shrink-0 text-[10px]">Current</Badge>}</div><p className="mt-0.5 text-[11px] text-muted-foreground">ClickHouse connector</p></div>
							</div>
							<p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">Telemetry, dashboards, and derived features for this project environment.</p>
							<div className="mt-3 flex flex-wrap gap-1.5"><Badge variant="secondary" className="text-[10px]">{config.environment || "production"}</Badge><Badge variant="outline" className="max-w-full truncate text-[10px]">{config.host}:{config.port}</Badge></div>
							<div className="mt-auto flex items-center justify-between gap-2 border-t border-stone-200 pt-3 dark:border-stone-800"><span className="text-[11px] text-muted-foreground">{config.database || "default"}</span><div className="flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => setCurrent(config)} disabled={!canSelect || config.isCurrent}>Use</Button><Button size="sm" variant="outline" onClick={() => setEditing(config)} disabled={!canUpdate || !config.permissions?.canEdit}>Edit</Button><Button size="sm" variant="ghost" onClick={() => remove(config)} disabled={!canDelete || !config.permissions?.canDelete}>Delete</Button></div></div>
						</div>
					))}
				</div>
			)}
			{editing && <Dialog open onOpenChange={(open) => !open && setEditing(null)}><DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto p-0"><ModifyDatabaseConfig dbConfig={editing === "new" ? undefined : editing} canCreate={canCreate} canUpdate={canUpdate} onSaved={() => setEditing(null)} /></DialogContent></Dialog>}
			{isLoadingList && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 dark:bg-stone-950/60"><div className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-muted-foreground shadow-sm dark:border-stone-800 dark:bg-stone-900">{messages.OBSERVABILITY_LOADING}</div></div>}
		</div>
	);
}

export default function Database({
	canCreate = true,
	canSelect = true,
	canUpdate = true,
	canDelete = true,
	canShare = true,
	openNew = false,
	onOpenNewHandled,
}: {
	canCreate?: boolean;
	canSelect?: boolean;
	canUpdate?: boolean;
	canDelete?: boolean;
	canShare?: boolean;
	openNew?: boolean;
	onOpenNewHandled?: () => void;
}) {
	const messages = getMessage();
	const databaseList = useRootStore(getDatabaseConfigList);
	const databaseListIsLoading = useRootStore(getDatabaseConfigListIsLoading);

	return isNil(databaseList) ? (
		<div className="flex items-center justify-center w-full h-full animate-pulse dark:text-white">
			{messages.OBSERVABILITY_LOADING}
		</div>
	) : (
		<DatabaseList
			dbConfigs={(databaseList as DatabaseConfigWithActive[]) || []}
			isLoadingList={databaseListIsLoading}
			canCreate={canCreate}
			canSelect={canSelect}
			canUpdate={canUpdate}
			canDelete={canDelete}
			canShare={canShare}
			openNew={openNew}
			onOpenNewHandled={onOpenNewHandled}
		/>
	);
}
