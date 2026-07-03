import { getDatabaseConfigList } from "@/selectors/database-config";
import { getCurrentProject } from "@/selectors/project";
import { useRootStore } from "@/store";
import { useEffect } from "react";
import {
	changeActiveDatabaseConfig,
	fetchDatabaseConfigList,
} from "@/helpers/client/database-config";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import getMessage from "@/constants/messages";
import { cn } from "@/lib/utils";
import { headerScopeTriggerClassName } from "../header-scope-pill";

type DatabaseConfigSwitchProps = {
	className?: string;
	contentAlign?: "center" | "end" | "start";
	contentSide?: "bottom" | "left" | "right" | "top";
};

const triggerClasses = headerScopeTriggerClassName;

export default function DatabaseConfigSwitch({
	className,
	contentAlign = "start",
	contentSide = "right",
}: DatabaseConfigSwitchProps) {
	const posthog = usePostHog();
	const router = useRouter();
	const messages = getMessage();
	const list = useRootStore(getDatabaseConfigList) || [];
	const currentProject = useRootStore(getCurrentProject);
	const activeDatabase = list.find((item) => !!item.isCurrent);
	const manageDbConfigHref = currentProject?.id
		? `/organisation/project/${currentProject.id}`
		: "/organisation";
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
			<button
				type="button"
				className={cn(triggerClasses, className)}
				onClick={() => router.push(manageDbConfigHref)}
			>
				<span className="min-w-0 truncate">{messages.MANAGE_DB_CONFIG}</span>
				<ChevronDown className="size-3 shrink-0 opacity-50" />
			</button>
		);
	}

	const activeDatabaseId = activeDatabase?.id;
	const displayDatabaseName = activeDatabase?.name || messages.PLEASE_SELECT;

	return (
		<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(triggerClasses, className)}>
					<span className="min-w-0 truncate">{displayDatabaseName}</span>
					<ChevronDown className="size-3 shrink-0 opacity-50" />
				</button>
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
					<Link href={manageDbConfigHref} className=" flex items-center">
						{messages.ADD_NEW_CONFIG}
					</Link>
				</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
	);
}
