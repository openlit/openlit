import { DatabaseConfigWithActive } from "@/constants/dbConfig";
import { getDatabaseConfigList } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { useEffect } from "react";
import {
	changeActiveDatabaseConfig,
	fetchDatabaseConfigList,
} from "@/helpers/database-config";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

export default function DatabaseConfigSwitch() {
	const list = useRootStore(getDatabaseConfigList) || [];
	const activeDatabase = list.find((item) => !!item.isCurrent);
	const onClickItem = (id: string) => {
		changeActiveDatabaseConfig(id);
	};

	useEffect(() => {
		fetchDatabaseConfigList();
	}, []);

	console.log(activeDatabase);
	if (!activeDatabase) return null;

	return (
		<div className="flex mr-6">
			<Select onValueChange={onClickItem} value={activeDatabase.id}>
				<SelectTrigger
					id="model"
					className="items-center [&_[data-description]]:hidden  dark:text-white"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{list.map((item) => (
						<SelectItem key={item.id} value={item.id}>
							<div className="flex items-start text-muted-foreground ">
								<div className="grid">
									<p>
										<span className="font-medium text-foreground">
											{item.name}
										</span>
									</p>
									<p className="text-xs" data-description>
										{item.environment}
									</p>
								</div>
							</div>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
