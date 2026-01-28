"use client";
import { Building2, ChevronsUpDown, Plus, Mail } from "lucide-react";
import {
	getCurrentOrganisation,
	getOrganisationList,
	getPendingInvitationsCount,
} from "@/selectors/organisation";
import { useRootStore } from "@/store";
import { useEffect, useState } from "react";
import { changeActiveOrganisation } from "@/helpers/client/organisation";
import { usePostHog } from "posthog-js/react";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ICON_CLASSES } from "@/constants/sidebar";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import CreateOrganisationDialog from "./create-organisation-dialog";
import getMessage from "@/constants/messages";

export default function OrganisationSwitch() {
	const posthog = usePostHog();
	const messages = getMessage();
	const list = useRootStore(getOrganisationList) || [];
	const currentOrg = useRootStore(getCurrentOrganisation);
	const pendingInvitationsCount = useRootStore(getPendingInvitationsCount);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);

	const onClickItem = (id: string) => {
		if (id === currentOrg?.id) return;
		changeActiveOrganisation(id, () => {
			posthog?.capture("organisation_switched");
		});
	};

	if (!currentOrg) return null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						className="flex gap-2 shrink-0 justify-start group-data-[state=close]:justify-center p-[calc(0.625rem-1px)] overflow-hidden text-stone-500 dark:text-stone-300 hover:bg-stone-700 dark:hover:bg-stone-600 hover:text-white font-normal relative"
					>
						<Building2 className={`${ICON_CLASSES} shrink-0`} />
						<span className="block group-data-[state=close]:hidden text-ellipsis overflow-hidden whitespace-nowrap grow text-left">
							{currentOrg?.name}
						</span>
						{pendingInvitationsCount > 0 && (
							<Badge
								variant="destructive"
								className="h-5 w-5 p-0 flex items-center justify-center text-xs group-data-[state=close]:absolute group-data-[state=close]:-top-1 group-data-[state=close]:-right-1"
							>
								{pendingInvitationsCount}
							</Badge>
						)}
						<ChevronsUpDown
							className={`size-4 block group-data-[state=close]:hidden shrink-0`}
						/>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-56" side="right" align="start">
					<DropdownMenuLabel>{messages.ORGANISATIONS}</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{list.map((item) => (
						<DropdownMenuCheckboxItem
							key={item.id}
							checked={item.id === currentOrg.id}
							onCheckedChange={() => onClickItem(item.id)}
						>
							<div className="flex items-start text-muted-foreground">
								<div className="grid">
									<p>
										<span className="font-medium text-foreground">
											{item.name}
										</span>
									</p>
									<p className="text-xs" data-description>
										{item.memberCount} {messages.MEMBER}{item.memberCount !== 1 ? "s" : ""}
									</p>
								</div>
							</div>
						</DropdownMenuCheckboxItem>
					))}
					<DropdownMenuSeparator />
					{pendingInvitationsCount > 0 && (
						<>
							<DropdownMenuItem className="py-1.5 pl-8 pr-2">
								<Link
									href="/settings/organisation"
									className="flex items-center gap-2"
								>
									<Mail className="size-4" />
									{pendingInvitationsCount} {messages.PENDING_INVITATION}
									{pendingInvitationsCount !== 1 ? "s" : ""}
								</Link>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					<DropdownMenuItem
						className="py-1.5 pl-8 pr-2"
						onSelect={() => setCreateDialogOpen(true)}
					>
						<div className="flex items-center gap-2">
							<Plus className="size-4" />
							{messages.CREATE_ORGANISATION}
						</div>
					</DropdownMenuItem>
					<DropdownMenuItem className="py-1.5 pl-8 pr-2">
						<Link
							href="/settings/organisation"
							className="flex items-center w-full"
						>
							{messages.MANAGE_ORGANISATIONS}
						</Link>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<CreateOrganisationDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
			/>
		</>
	);
}
