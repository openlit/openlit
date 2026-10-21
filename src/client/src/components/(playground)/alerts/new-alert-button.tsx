"use client";

import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import FeatureAccess from "@/components/rbac/feature-access";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import getMessage from "@/constants/messages";
import { getNewAlertOptions } from "@/components/(playground)/alerts/alert-sections";

// Same split button as the Dashboards header (RootActions).
const SPLIT =
	"h-8 bg-primary px-2 text-white hover:bg-primary/90 hover:text-white dark:bg-primary dark:text-white dark:hover:bg-primary/90 dark:hover:text-white";

export default function NewAlertButton() {
	const m = getMessage();
	const options = getNewAlertOptions();
	return (
		<FeatureAccess access="alerts.create" requireProject hideWhenDenied>
			<div className="inline-flex shrink-0 items-stretch">
				<Button asChild size="sm" className={`${SPLIT} rounded-r-none`}>
					<Link href="/alerts/new" aria-label={m.ALERTING_NEW} title={m.ALERTING_NEW}>
						<Plus className="size-4" />
					</Link>
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button type="button" size="sm" aria-label={m.ALERTING_NEW_MORE} className={`${SPLIT} rounded-l-none border-l border-white/20`}>
							<ChevronDown className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{options.map((option) => (
							<DropdownMenuItem key={option.id} asChild>
								<Link href={option.href}>
									<Plus className="mr-2 size-4" />
									{option.label}
								</Link>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</FeatureAccess>
	);
}
