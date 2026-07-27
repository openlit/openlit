import { getCurrentProject } from "@/selectors/project";
import { useRootStore } from "@/store";
import { useEffect, useState } from "react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
	const router = useRouter();
	const messages = getMessage();
	const currentProject = useRootStore(getCurrentProject);
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [environments, setEnvironments] = useState<string[]>(["production"]);
	const environment = searchParams.get("environment") || "production";
	const manageDbConfigHref = currentProject?.id
		? `/organisation/project/${currentProject.id}/connectors?environment=${encodeURIComponent(environment)}`
		: "/organisation";

	useEffect(() => {
		fetch("/api/project/environment").then((response) => response.ok ? response.json() : { environments: [] })
			.then((body) => setEnvironments(Array.from(new Set(["production", ...(body.environments || []).map((item: { name: string }) => item.name)]))))
			.catch(() => undefined);
	}, []);
	const onClickEnvironment = (nextEnvironment: string) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("environment", nextEnvironment);
		router.replace(`${pathname}?${params.toString()}`);
	};

	return (
		<DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(triggerClasses, className)}>
					<span className="min-w-0 truncate">{environment}</span>
					<ChevronDown className="size-3 shrink-0 opacity-50" />
				</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" side={contentSide} align={contentAlign}>
		<DropdownMenuLabel>{messages.CONNECTOR_ENVIRONMENT}</DropdownMenuLabel>
        <DropdownMenuSeparator />
				{environments.map((item) => (
					<DropdownMenuCheckboxItem
					key={item}
	          checked={item === environment}
	          onCheckedChange={() => onClickEnvironment(item)}
	        >
						<span className="font-medium text-foreground">{item}</span>
	        </DropdownMenuCheckboxItem>
				))}
        <DropdownMenuSeparator />
				<DropdownMenuItem className="py-1.5 pl-8 pr-2">
					<Link href={manageDbConfigHref} className=" flex items-center">
						{messages.MANAGE_PROJECTS}
					</Link>
				</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
	);
}
