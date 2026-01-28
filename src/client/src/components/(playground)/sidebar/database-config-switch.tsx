import { ChevronsUpDown, Database, Plus, Settings } from "lucide-react";
import { getDatabaseConfigList } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { useEffect } from "react";
import {
	changeActiveDatabaseConfig,
	fetchDatabaseConfigList,
} from "@/helpers/client/database-config";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ICON_CLASSES } from "@/constants/sidebar";
import Link from "next/link";
import { useRouter } from "next/navigation";
import getMessage from "@/constants/messages";

export default function DatabaseConfigSwitch() {
	const posthog = usePostHog();
	const router = useRouter();
	const messages = getMessage();
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

	// Show manage button when no database configs exist
	if (list.length === 0) {
		return (
			<Button
				variant="outline"
				className="flex gap-2 shrink-0 justify-start group-data-[state=close]:justify-center p-[calc(0.625rem-1px)] overflow-hidden text-stone-500 dark:text-stone-300 hover:bg-stone-700 dark:hover:bg-stone-600 hover:text-white font-normal"
				onClick={() => router.push("/settings/database-config")}
			>
				<Settings className={`${ICON_CLASSES} shrink-0`} />
				<span className="block group-data-[state=close]:hidden text-ellipsis overflow-hidden whitespace-nowrap grow text-left">
					{messages.MANAGE_DB_CONFIG}
				</span>
			</Button>
		);
	}

	// If there are configs but none are active, show dropdown with first config
	const displayDatabase = activeDatabase || list[0];

	return (
		<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="flex gap-2 shrink-0 justify-start group-data-[state=close]:justify-center p-[calc(0.625rem-1px)] overflow-hidden text-stone-500 dark:text-stone-300 hover:bg-stone-700 dark:hover:bg-stone-600 hover:text-white font-normal">
					<Database className={`${ICON_CLASSES} shrink-0`} />
					<span className="block group-data-[state=close]:hidden text-ellipsis overflow-hidden whitespace-nowrap grow text-left">{displayDatabase?.name}</span>
					<ChevronsUpDown className={`size-4 block group-data-[state=close]:hidden shrink-0`} />
				</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" side="right" align="start">
        <DropdownMenuLabel>{messages.DATABASES}</DropdownMenuLabel>
        <DropdownMenuSeparator />
				{list.map((item) => (
					<DropdownMenuCheckboxItem
					key={item.id}
          checked={item.id === displayDatabase?.id}
          onCheckedChange={() => onClickItem(item.id)}
        >
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
        </DropdownMenuCheckboxItem>
				))}
        <DropdownMenuSeparator />
				<DropdownMenuItem className="py-1.5 pl-8 pr-2">
					<Link href="/settings/database-config" className=" flex items-center">
						{messages.ADD_NEW_CONFIG}
					</Link>
				</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
	);
}