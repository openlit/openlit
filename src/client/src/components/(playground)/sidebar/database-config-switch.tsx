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
import Link from "next/link";
import { useRouter } from "next/navigation";
import getMessage from "@/constants/messages";
import { cn } from "@/lib/utils";

type DatabaseConfigSwitchProps = {
	className?: string;
	contentAlign?: "center" | "end" | "start";
	contentSide?: "bottom" | "left" | "right" | "top";
};

const triggerClasses = "flex h-9 min-w-32 max-w-56 shrink-0 items-center justify-start overflow-hidden px-3 py-1.5 text-left font-normal";

export default function DatabaseConfigSwitch({
	className,
	contentAlign = "start",
	contentSide = "right",
}: DatabaseConfigSwitchProps) {
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
				className={cn(triggerClasses, className)}
				onClick={() => router.push("/settings/database-config")}
			>
				<span className="min-w-0 truncate text-xs font-medium">
					{messages.MANAGE_DB_CONFIG}
				</span>
			</Button>
		);
	}

	const activeDatabaseId = activeDatabase?.id;
	const displayDatabaseName = activeDatabase?.name || messages.PLEASE_SELECT;

	return (
		<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn(triggerClasses, className)}>
					<span className="min-w-0 truncate text-xs font-medium">{displayDatabaseName}</span>
				</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" side={contentSide} align={contentAlign}>
        <DropdownMenuLabel>{messages.DATABASES}</DropdownMenuLabel>
        <DropdownMenuSeparator />
				{list.map((item) => (
					<DropdownMenuCheckboxItem
					key={item.id}
          checked={item.id === activeDatabaseId}
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
