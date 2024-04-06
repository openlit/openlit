import { DatabaseConfigWithActive } from "@/constants/dbConfig";
import { getDatabaseConfigList } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import Dropdown from "../common/drop-down";
import { MouseEventHandler, useEffect } from "react";
import { changeActiveDatabaseConfig, fetchDatabaseConfigList } from "@/helpers/database-config";

function ActiveDatabase({
	activeDatabase,
}: {
	activeDatabase: DatabaseConfigWithActive;
}) {
	return (
		<div className="flex-1 w-40 bg-secondary py-1 px-2 text-primary outline-none focus:ring-0 text-sm cursor-pointer">
			{activeDatabase.name}
		</div>
	);
}

export default function DatabaseConfigSwitch() {
	const list = useRootStore(getDatabaseConfigList);
	const activeDatabase = list.find((item) => !!item.isCurrent);
	const onClickItem: MouseEventHandler<HTMLAnchorElement> = (event) => {
		const { id } = (event.target as HTMLAnchorElement).dataset;
		if (!id) return;
		changeActiveDatabaseConfig(id);
	};
	const itemList = list
		.filter((item) => item.id !== activeDatabase?.id)
		.map(({ id, name }) => ({
			label: name,
			id,
			onClick: onClickItem,
		}));

	useEffect(() => {
		fetchDatabaseConfigList();
	}, []);

	if (!activeDatabase) return null;

	return (
		<div className="flex mr-5">
			<Dropdown
				triggerComponent={<ActiveDatabase activeDatabase={activeDatabase} />}
				itemList={itemList}
			/>
		</div>
	);
}
