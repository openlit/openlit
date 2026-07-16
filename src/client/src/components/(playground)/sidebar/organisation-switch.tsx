"use client";
import { Plus, Mail, ChevronDown } from "lucide-react";
import {
	getCurrentOrganisation,
	getOrganisationList,
	getPendingInvitationsCount,
} from "@/selectors/organisation";
import { useRootStore } from "@/store";
import { useState } from "react";
import { changeActiveOrganisation } from "@/helpers/client/organisation";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import CreateOrganisationDialog from "./create-organisation-dialog";
import getMessage from "@/constants/messages";
import { cn } from "@/lib/utils";
import { headerScopeTriggerClassName } from "../header-scope-pill";

type OrganisationSwitchProps = {
	className?: string;
	contentAlign?: "center" | "end" | "start";
	contentSide?: "bottom" | "left" | "right" | "top";
};

const triggerClasses = headerScopeTriggerClassName;

export default function OrganisationSwitch({
	className,
	contentAlign = "start",
	contentSide = "right",
}: OrganisationSwitchProps) {
	const messages = getMessage();
	const list = useRootStore(getOrganisationList) || [];
	const currentOrg = useRootStore(getCurrentOrganisation);
	const pendingInvitationsCount = useRootStore(getPendingInvitationsCount);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);

	const onClickItem = (id: string) => {
		if (id === currentOrg?.id) return;
		changeActiveOrganisation(id);
	};

	if (!currentOrg) return null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button type="button" className={cn(triggerClasses, className)}>
						<span className="min-w-0 truncate">{currentOrg?.name}</span>
						{pendingInvitationsCount > 0 && (
							<Badge
								variant="destructive"
								className="h-4 min-w-4 px-1 flex items-center justify-center text-[10px]"
							>
								{pendingInvitationsCount}
							</Badge>
						)}
						<ChevronDown className="size-3 shrink-0 opacity-50" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-56" side={contentSide} align={contentAlign}>
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
									href="/organisation"
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
							href="/organisation"
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
