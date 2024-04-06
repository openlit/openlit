import FormBuilder from "@/components/common/form-builder";
import SideTabs, { SideTabItemProps } from "@/components/common/side-tabs";
import { DatabaseConfig, DatabaseConfigWithActive } from "@/constants/dbConfig";
import {
	changeActiveDatabaseConfig,
	deleteDatabaseConfig,
	fetchDatabaseConfigList,
} from "@/helpers/database-config";
import {
	getDatabaseConfigList,
	getDatabaseConfigListIsLoading,
} from "@/selectors/database-config";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { keyBy } from "lodash";
import {
	FormEventHandler,
	MouseEventHandler,
	useCallback,
	useState,
} from "react";
import toast from "react-hot-toast";

function ModifyDatabaseConfig({
	dbConfig,
}: {
	dbConfig?: DatabaseConfigWithActive;
}) {
	const { fireRequest, isLoading } = useFetchWrapper();

	const modifyDetails: FormEventHandler<HTMLFormElement> = useCallback(
		(event) => {
			event.preventDefault();
			const formElement = event.target as HTMLFormElement;

			toast.loading("Modifying db config...", {
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
					fetchDatabaseConfigList();
					toast.success("Db config updated!", {
						id: "db-config-details",
					});
					if (!dbConfig?.id) formElement.reset();
				},
				failureCb: (err?: string) => {
					toast.error(err || "Db config updation failed!", {
						id: "db-config-details",
					});
				},
			});
		},
		[dbConfig?.id]
	);

	return (
		<FormBuilder
			fields={[
				{
					label: "Config Name",
					type: "text",
					name: "name",
					placeholder: "db-config",
					defaultValue: dbConfig?.name,
					inputKey: `${dbConfig?.id}-name`,
				},
				{
					label: "Environment",
					type: "text",
					name: "environment",
					placeholder: "production",
					defaultValue: dbConfig?.environment,
					inputKey: `${dbConfig?.id}-environment`,
				},
				{
					label: "Username",
					type: "text",
					name: "username",
					placeholder: "username",
					defaultValue: dbConfig?.username,
					inputKey: `${dbConfig?.id}-username`,
				},
				{
					label: "Password",
					type: "password",
					name: "password",
					placeholder: "*******",
					inputKey: `${dbConfig?.id}-password`,
				},
				{
					label: "Host",
					type: "text",
					name: "host",
					placeholder: "127.0.0.1",
					defaultValue: dbConfig?.host,
					inputKey: `${dbConfig?.id}-host`,
				},
				{
					label: "Port",
					type: "number",
					name: "port",
					placeholder: "8123",
					defaultValue: dbConfig?.port,
					inputKey: `${dbConfig?.id}-port`,
				},
				{
					label: "Database",
					type: "text",
					name: "database",
					placeholder: "doku",
					defaultValue: dbConfig?.database,
					inputKey: `${dbConfig?.id}-database`,
				},
				{
					label: "Query params",
					type: "text",
					name: "query",
					placeholder: "a=b&c=d",
					defaultValue: dbConfig?.query,
					inputKey: `${dbConfig?.id}-query`,
				},
			]}
			heading={`${dbConfig?.id ? "Update" : "Add"} database config`}
			isLoading={isLoading}
			onSubmit={modifyDetails}
			submitButtonText={dbConfig?.id ? "Update" : "Save"}
		/>
	);
}

const ADD_NEW_ID = "ADD_NEW_ID";

function DatabaseList({
	dbConfigs,
	isLoadingList,
}: {
	dbConfigs: DatabaseConfigWithActive[];
	isLoadingList: boolean;
}) {
	const [selectedDBConfigId, setSelectedDBConfigId] = useState<string>(
		dbConfigs[0]?.id || ADD_NEW_ID
	);

	const dbConfigByKey = keyBy(dbConfigs, "id");

	const onClickDB: MouseEventHandler<HTMLElement> = (event) => {
		const { itemId = "" } = (
			(event.target as HTMLElement).closest("li") as HTMLLIElement
		).dataset;
		setSelectedDBConfigId(itemId);
	};

	const onClickDelete: MouseEventHandler<SVGSVGElement> = (event) => {
		event.stopPropagation();
		const { itemId = "" } = (
			(event.target as SVGSVGElement).closest("li") as HTMLLIElement
		).dataset;

		if (itemId) deleteDatabaseConfig(itemId);
	};

	const onClickSetCurrent: MouseEventHandler<HTMLDivElement> = (event) => {
		event.stopPropagation();
		const { itemId = "" } = (
			(event.target as HTMLDivElement).closest("li") as HTMLLIElement
		).dataset;

		if (itemId) {
			toast.loading(
				`Db config: ${dbConfigByKey[itemId].name} setting active!`,
				{
					id: "db-config-current",
				}
			);
			changeActiveDatabaseConfig(itemId);
		}
	};

	const items: SideTabItemProps[] = dbConfigs.map((dbConfig) => ({
		id: dbConfig.id,
		name: dbConfig.name,
		badge: dbConfig.environment,
		isCurrent: !!dbConfig.isCurrent,
		enableActiveChange: true,
		enableDeletion: true,
	}));

	items.push({
		id: ADD_NEW_ID,
		name: "Add New",
	});

	return (
		<div className="flex flex-1 h-full border-t border-secondary relative">
			<SideTabs
				items={items}
				onClickTab={onClickDB}
				selectedTabId={selectedDBConfigId}
				onClickItemChangeActive={onClickSetCurrent}
				onClickItemDelete={onClickDelete}
			/>
			<div className="flex flex-1 w-full h-full">
				<ModifyDatabaseConfig dbConfig={dbConfigByKey[selectedDBConfigId]} />
			</div>
			{isLoadingList && (
				<div className="flex absolute w-full left-0 top-0 h-full bg-secondary/[0.1] animate-pulse z-10" />
			)}
		</div>
	);
}

export default function Database() {
	const databaseList = useRootStore(getDatabaseConfigList);
	const databaseListIsLoading = useRootStore(getDatabaseConfigListIsLoading);

	return databaseListIsLoading && databaseList.length === 0 ? (
		<div className="flex items-center justify-center w-full h-full bg-secondary text-primary animate-pulse">
			Loading...
		</div>
	) : (
		<DatabaseList
			dbConfigs={(databaseList as DatabaseConfigWithActive[]) || []}
			isLoadingList={databaseListIsLoading}
		/>
	);
}
