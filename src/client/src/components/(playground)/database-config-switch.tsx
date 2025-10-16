import { getDatabaseConfigList } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { useEffect } from "react";
import {
	changeActiveDatabaseConfig,
	fetchDatabaseConfigList,
} from "@/helpers/client/database-config";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

export default function DatabaseConfigSwitch() {
	const posthog = usePostHog();
	const list = useRootStore(getDatabaseConfigList) || [];
	const activeDatabase = list.find((item) => !!item.isCurrent);
	const onClickItem = (id: string) => {
		changeActiveDatabaseConfig(id, () => {
			posthog?.capture(CLIENT_EVENTS.DB_CONFIG_ACTION_CHANGE);
		});
	};

	useEffect(() => {
		fetchDatabaseConfigList((data: any[]) => {
			posthog?.capture(CLIENT_EVENTS.DB_CONFIG_LIST, {
				count: data.length,
			});
		});
	}, []);

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
