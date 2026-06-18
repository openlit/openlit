"use client";

import FormBuilder from "@/components/common/form-builder";
import DatabaseConfigTabs from "@/components/(playground)/database-config/database-config-tabs";
import { Button } from "@/components/ui/button";
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
import { isNil, keyBy } from "lodash";
import { MouseEventHandler, useCallback, useState } from "react";
import { toast } from "sonner";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { DatabaseConfigTabItemProps } from "@/types/database-config";
import { FormBuilderEvent } from "@/types/form";
import { PRIMARY_BACKGROUND } from "@/constants/common-classes";
import getMessage from "@/constants/messages";

function ModifyDatabaseConfig({
	dbConfig,
}: {
	dbConfig?: DatabaseConfigWithActive;
}) {
	const posthog = usePostHog();
	const { fireRequest, isLoading } = useFetchWrapper();
	const messages = getMessage();

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
		[dbConfig?.id]
	);

	const formFieldsDisabled =
		dbConfig?.id && !dbConfig?.permissions?.canEdit ? true : false;

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
					fieldType: "INPUT",
					fieldTypeProps: {
						type: "text",
						name: "environment",
						placeholder: "production",
						defaultValue: dbConfig?.environment,
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
						? messages.DATABASE_CONFIG
						: messages.UPDATE_DB_CONFIG
					: messages.ADD_DB_CONFIG
			}
			subHeading={
				!dbConfig?.id || dbConfig?.permissions?.canEdit
					? ""
					: messages.DB_CONFIG_EDIT_PERMISSION_REQUIRED
			}
			subHeadingClass="text-error"
			isLoading={isLoading}
			onSubmit={modifyDetails}
			isAllowedToSubmit={!dbConfig?.id || !!dbConfig?.permissions?.canEdit}
			submitButtonText={dbConfig?.id ? messages.UPDATE : messages.SAVE}
		/>
	);
}
function DatabaseList({
	dbConfigs,
	isLoadingList,
}: {
	dbConfigs: DatabaseConfigWithActive[];
	isLoadingList: boolean;
}) {
	const posthog = usePostHog();
	const messages = getMessage();
	const [selectedDBConfigId, setSelectedDBConfigId] = useState<
		string | undefined
	>();

	const dbConfigByKey = keyBy(dbConfigs, "id");

	const onClickDB: MouseEventHandler<HTMLDivElement | HTMLButtonElement> = (
		event
	) => {
		const parent = (event.target as HTMLElement).closest(
			".item-element-card"
		) as HTMLElement;
		if (!parent) return null;
		const { itemId = "" } = parent.dataset;
		setSelectedDBConfigId(itemId);
	};

	const onClickDelete: MouseEventHandler<SVGSVGElement> = (event) => {
		event.stopPropagation();
		const parent = (event.target as HTMLElement).closest(
			".item-element-card"
		) as HTMLElement;
		if (!parent) return null;
		const { itemId = "" } = parent.dataset;

		if (itemId) deleteDatabaseConfig(itemId);
	};

	const onClickSetCurrent: MouseEventHandler<HTMLDivElement> = (event) => {
		event.stopPropagation();
		const parent = (event.target as HTMLElement).closest(
			".item-element-card"
		) as HTMLElement;
		if (!parent) return null;
		const { itemId = "" } = parent.dataset;

		if (itemId) {
			toast.loading(
				messages.DB_CONFIG_SET_ACTIVE(dbConfigByKey[itemId].name),
				{
					id: "db-config-current",
				}
			);
			changeActiveDatabaseConfig(itemId, () => {
				posthog?.capture(CLIENT_EVENTS.DB_CONFIG_ACTION_CHANGE);
			});
		}
	};

	const items: DatabaseConfigTabItemProps[] = dbConfigs.map((dbConfig) => ({
		id: dbConfig.id,
		name: dbConfig.name,
		badge: dbConfig.environment,
		isCurrent: !!dbConfig.isCurrent,
		canDelete: !!dbConfig.permissions?.canDelete,
		canEdit: !!dbConfig.permissions?.canEdit,
		canShare: !!dbConfig.permissions?.canShare,
	}));

	return (
		<div className="flex w-full flex-1 relative">
			<DatabaseConfigTabs
				addButton
				items={items}
				onClickTab={onClickDB}
				selectedTabId={selectedDBConfigId || ""}
				onClickItemChangeActive={onClickSetCurrent}
				onClickItemDelete={onClickDelete}
			/>
			<div className="flex flex-1 w-full h-full overflow-hidden">
				{selectedDBConfigId ? (
					<ModifyDatabaseConfig dbConfig={dbConfigByKey[selectedDBConfigId]} />
				) : (
					<div className="flex flex-1 items-center justify-center">
						<div className="flex flex-col items-center gap-1 text-center">
							<h3 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
								{dbConfigs.length === 0
									? messages.DB_CONFIG_EMPTY_TITLE
									: messages.DB_CONFIG_NOT_SELECTED_TITLE}
							</h3>
							<p className="text-sm text-stone-700 dark:text-stone-300">
								{dbConfigs.length === 0
									? messages.DB_CONFIG_EMPTY_DESCRIPTION
									: messages.DB_CONFIG_NOT_SELECTED_DESCRIPTION}
							</p>
							{dbConfigs.length !== 0 && (
								<Button
									className="mt-4 item-element-card"
									data-item-id={"ADD_NEW_ID"}
									onClick={onClickDB}
								>
									{messages.ADD_DATABASE_CONFIG}
								</Button>
							)}
						</div>
					</div>
				)}
			</div>
			{isLoadingList && (
				<div className="flex absolute w-full left-0 top-0 h-full animate-pulse z-10" />
			)}
		</div>
	);
}

export default function Database() {
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
		/>
	);
}
