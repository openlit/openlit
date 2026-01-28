"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Building2,
	Mail,
	Check,
	X,
	Trash2,
	UserPlus,
	Crown,
	LogOut,
	Loader2,
	Save,
	Users,
	Settings,
	Clock,
} from "lucide-react";
import { useRootStore } from "@/store";
import {
	getCurrentOrganisation,
	getOrganisationList,
	getOrganisationPendingInvitations,
	getOrganisationIsLoading,
} from "@/selectors/organisation";
import { getCurrentUserId } from "@/selectors/user";
import {
	updateOrganisation,
	deleteOrganisation,
	inviteToOrganisation,
	acceptInvitation,
	declineInvitation,
	removeOrganisationMember,
	cancelOrganisationInvitation,
	fetchOrganisationList,
	fetchPendingInvitations,
	changeActiveOrganisation,
	updateMemberRole,
} from "@/helpers/client/organisation";
import { getData } from "@/utils/api";
import asaw from "@/utils/asaw";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import CreateOrganisationDialog from "@/components/(playground)/sidebar/create-organisation-dialog";
import getMessage from "@/constants/messages";

interface Member {
	id: string;
	email: string;
	name: string | null;
	image: string | null;
	isCreator: boolean;
	role: "owner" | "admin" | "member";
	joinedAt: string;
}

interface PendingInvite {
	id: string;
	email: string;
	invitedAt: string;
}

export default function OrganisationSettingsPage() {
	const router = useRouter();
	const messages = getMessage();
	const currentOrg = useRootStore(getCurrentOrganisation);
	const organisations = useRootStore(getOrganisationList) || [];
	const pendingInvitations = useRootStore(getOrganisationPendingInvitations);
	const currentUserId = useRootStore(getCurrentUserId);
	const isOrgLoading = useRootStore(getOrganisationIsLoading);

	const [orgName, setOrgName] = useState("");
	const [inviteEmail, setInviteEmail] = useState("");
	const [members, setMembers] = useState<Member[]>([]);
	const [orgPendingInvites, setOrgPendingInvites] = useState<PendingInvite[]>(
		[]
	);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [isInviting, setIsInviting] = useState(false);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [hasFetchedOrgs, setHasFetchedOrgs] = useState(false);

	const isCreator = currentOrg?.createdByUserId === currentUserId;

	// Fetch organisations on mount
	useEffect(() => {
		const fetchData = async () => {
			await fetchOrganisationList();
			await fetchPendingInvitations();
			setHasFetchedOrgs(true);
		};
		fetchData();
	}, []);

	// Redirect to onboarding if user has no organisations after fetch completes
	useEffect(() => {
		if (hasFetchedOrgs && !isOrgLoading && organisations.length === 0) {
			router.push("/onboarding");
		}
	}, [hasFetchedOrgs, isOrgLoading, organisations.length, router]);

	useEffect(() => {
		if (currentOrg) {
			setOrgName(currentOrg.name);
			fetchMembers();
		}
	}, [currentOrg?.id]);

	const fetchMembers = async () => {
		if (!currentOrg) return;

		setIsLoading(true);
		const [err, data] = await asaw(
			getData({
				url: `/api/organisation/${currentOrg.id}/members`,
				method: "GET",
			})
		);
		setIsLoading(false);

		if (!err && data) {
			setMembers(data.members || []);
			setOrgPendingInvites(data.pendingInvites || []);
		}
	};

	const handleSaveName = async () => {
		if (!currentOrg || !orgName.trim() || orgName === currentOrg.name) return;

		setIsSaving(true);
		await updateOrganisation(currentOrg.id, orgName.trim());
		setIsSaving(false);
	};

	const handleInvite = async () => {
		if (!currentOrg || !inviteEmail.trim()) return;

		setIsInviting(true);
		await inviteToOrganisation(currentOrg.id, [inviteEmail.trim()], () => {
			setInviteEmail("");
			fetchMembers();
		});
		setIsInviting(false);
	};

	const handleRemoveMember = async (userId: string) => {
		if (!currentOrg) return;
		await removeOrganisationMember(currentOrg.id, userId, fetchMembers);
	};

	const handleCancelInvite = async (inviteId: string) => {
		await cancelOrganisationInvitation(inviteId, fetchMembers);
	};

	const handleUpdateRole = async (userId: string, role: string) => {
		if (!currentOrg) return;
		await updateMemberRole(currentOrg.id, userId, role, fetchMembers);
	};

	const handleLeaveOrg = async () => {
		if (!currentOrg || !currentUserId) return;

		await removeOrganisationMember(currentOrg.id, currentUserId, async () => {
			await fetchOrganisationList();
			// Switch to another org if available
			const updatedList = useRootStore.getState().organisation.list || [];
			if (updatedList.length > 0) {
				await changeActiveOrganisation(updatedList[0].id);
			}
		});
	};

	const handleDeleteOrg = async () => {
		if (!currentOrg) return;

		await deleteOrganisation(currentOrg.id, async () => {
			await fetchOrganisationList();
			// Switch to another org if available
			const updatedList = useRootStore.getState().organisation.list || [];
			if (updatedList.length > 0) {
				await changeActiveOrganisation(updatedList[0].id);
			}
		});
	};

	const handleAcceptInvitation = async (invitationId: string) => {
		await acceptInvitation(invitationId, async () => {
			await fetchOrganisationList();
			await fetchPendingInvitations();
		});
	};

	const handleDeclineInvitation = async (invitationId: string) => {
		await declineInvitation(invitationId);
	};

	return (
		<div className="p-4 space-y-4 overflow-auto w-full">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-xl font-bold">{messages.ORGANISATION_SETTINGS}</h1>
					<p className="text-sm text-muted-foreground">
						{messages.ORGANISATION_SETTINGS_DESCRIPTION}
					</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)} size="sm">
					<Building2 className="h-3.5 w-3.5 mr-1.5" />
					{messages.NEW_ORGANISATION}
				</Button>
			</div>

			{pendingInvitations.length > 0 && (
				<Card className="border-primary/20 bg-primary/5">
					<CardHeader className="pb-3">
						<CardTitle className="text-base flex items-center gap-2">
							<Mail className="h-4 w-4" />
							{messages.PENDING_INVITATIONS}
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{pendingInvitations.map((invitation) => (
							<div
								key={invitation.id}
								className="flex items-center justify-between p-2 border rounded-md bg-background"
							>
								<p className="text-sm font-medium">{invitation.organisationName}</p>
								<div className="flex gap-1">
									<Button
										size="sm"
										variant="ghost"
										className="h-7 w-7 p-0"
										onClick={() => handleDeclineInvitation(invitation.id)}
									>
										<X className="h-3.5 w-3.5" />
									</Button>
									<Button
										size="sm"
										className="h-7"
										onClick={() => handleAcceptInvitation(invitation.id)}
									>
										<Check className="h-3.5 w-3.5 mr-1" />
										{messages.JOIN}
									</Button>
								</div>
							</div>
						))}
					</CardContent>
				</Card>
			)}

			{currentOrg && (
				<Tabs defaultValue="details" className="w-full">
					<TabsList className="w-full justify-start p-0 h-auto">
						<TabsTrigger value="details" className="text-xs">
							<Settings className="h-3.5 w-3.5 mr-1.5" />
							{messages.DETAILS}
						</TabsTrigger>
						<TabsTrigger value="members" className="text-xs">
							<Users className="h-3.5 w-3.5 mr-1.5" />
							{messages.MEMBERS} ({members.length})
						</TabsTrigger>
						{orgPendingInvites.length > 0 && (
							<TabsTrigger value="pending" className="text-xs">
								<Clock className="h-3.5 w-3.5 mr-1.5" />
								{messages.PENDING} ({orgPendingInvites.length})
							</TabsTrigger>
						)}
						<TabsTrigger value="all" className="text-xs">
							<Building2 className="h-3.5 w-3.5 mr-1.5" />
							{messages.ORGANISATIONS}
						</TabsTrigger>
					</TabsList>

					<TabsContent value="details" className="space-y-4 mt-0">
						<div className="space-y-3 p-4">
							<div className="space-y-1.5">
								<Label htmlFor="org-name" className="text-sm">
									{messages.ORGANISATION_NAME}
								</Label>
								<div className="flex gap-2">
									<Input
										id="org-name"
										value={orgName}
										onChange={(e) => setOrgName(e.target.value)}
										className="h-9"
									/>
									<Button
										onClick={handleSaveName}
										disabled={
											isSaving ||
											!orgName.trim() ||
											orgName === currentOrg.name
										}
										size="sm"
										className="h-9"
									>
										<Save className="h-3.5 w-3.5 mr-1.5" />
										{isSaving ? messages.SAVING : messages.SAVE}
									</Button>
								</div>
							</div>

							<div className="space-y-1.5">
								<Label htmlFor="invite-email" className="text-sm">
									{messages.INVITE_NEW_MEMBER}
								</Label>
								<div className="flex gap-2">
									<Input
										id="invite-email"
										placeholder="email@example.com"
										type="email"
										value={inviteEmail}
										onChange={(e) => setInviteEmail(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												handleInvite();
											}
										}}
										className="h-9"
									/>
									<Button
										onClick={handleInvite}
										disabled={isInviting || !inviteEmail.trim()}
										size="sm"
										className="h-9"
									>
										<UserPlus className="h-3.5 w-3.5 mr-1.5" />
										{isInviting ? messages.INVITING : messages.INVITE}
									</Button>
								</div>
							</div>
						</div>

						{isCreator && (
							<div className="border-t pt-4 px-4 pb-4">
								<div className="space-y-2">
									<h4 className="text-sm font-medium text-destructive">
										{messages.DANGER_ZONE}
									</h4>
									<p className="text-xs text-muted-foreground">
										{messages.DANGER_ZONE_DESCRIPTION}
									</p>
									<AlertDialog>
										<AlertDialogTrigger asChild>
											<Button
												variant="destructive"
												size="sm"
												className="h-8"
												disabled={members.length > 1}
											>
												<Trash2 className="h-3.5 w-3.5 mr-1.5" />
												{messages.DELETE_ORGANISATION}
											</Button>
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>
													{messages.DELETE_ORGANISATION}
												</AlertDialogTitle>
												<AlertDialogDescription>
													{messages.DELETE_ORGANISATION_CONFIRMATION}
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>
													{messages.CANCEL}
												</AlertDialogCancel>
												<AlertDialogAction onClick={handleDeleteOrg}>
													{messages.DELETE}
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
									{members.length > 1 && (
										<p className="text-xs text-muted-foreground">
											Remove all members before deleting this organisation.
										</p>
									)}
								</div>
							</div>
						)}
					</TabsContent>

					<TabsContent value="members" className="mt-0 p-0 pt-2">
						{isLoading ? (
							<div className="flex items-center justify-center py-8">
								<Loader2 className="h-5 w-5 animate-spin" />
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow className="text-xs">
										<TableHead className="h-8 pl-2">{messages.MEMBER}</TableHead>
										<TableHead className="h-8">{messages.ROLE}</TableHead>
										<TableHead className="h-8 text-right">
											{messages.ACTIONS}
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{members.map((member) => (
										<TableRow key={member.id} className="text-sm">
											<TableCell className="py-2 pl-2">
												<div>
													<p className="font-medium">
														{member.name || member.email}
													</p>
													{member.name && (
														<p className="text-xs text-muted-foreground">
															{member.email}
														</p>
													)}
												</div>
											</TableCell>
											<TableCell className="py-2">
												{member.isCreator ? (
													<Badge
														variant="secondary"
														className="text-xs h-5 px-2"
													>
														<Crown className="h-3 w-3 mr-1" />
														{messages.OWNER}
													</Badge>
												) : isCreator ? (
													<Select
														value={member.role}
														onValueChange={(value) =>
															handleUpdateRole(member.id, value)
														}
													>
														<SelectTrigger className="h-7 w-auto text-xs">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="admin" className="text-xs">
																{messages.ADMIN}
															</SelectItem>
															<SelectItem value="member" className="text-xs">
																{messages.MEMBER}
															</SelectItem>
														</SelectContent>
													</Select>
												) : (
													<Badge variant="outline" className="text-xs h-5 px-2">
														{member.role === "admin"
															? messages.ADMIN
															: messages.MEMBER}
													</Badge>
												)}
											</TableCell>
											<TableCell className="py-2 text-right">
												<div className="flex justify-end gap-1">
													{!member.isCreator && isCreator && (
														<AlertDialog>
															<AlertDialogTrigger asChild>
																<Button
																	variant="ghost"
																	size="sm"
																	className="h-7 w-7 p-0 text-destructive"
																>
																	<Trash2 className="h-3.5 w-3.5" />
																</Button>
															</AlertDialogTrigger>
															<AlertDialogContent>
																<AlertDialogHeader>
																	<AlertDialogTitle>
																		{messages.REMOVE_MEMBER}
																	</AlertDialogTitle>
																	<AlertDialogDescription>
																		{messages.REMOVE_MEMBER_CONFIRMATION}
																	</AlertDialogDescription>
																</AlertDialogHeader>
																<AlertDialogFooter>
																	<AlertDialogCancel>
																		{messages.CANCEL}
																	</AlertDialogCancel>
																	<AlertDialogAction
																		onClick={() =>
																			handleRemoveMember(member.id)
																		}
																	>
																		{messages.DELETE}
																	</AlertDialogAction>
																</AlertDialogFooter>
															</AlertDialogContent>
														</AlertDialog>
													)}
													{member.id === currentUserId && !member.isCreator && (
														<AlertDialog>
															<AlertDialogTrigger asChild>
																<Button
																	variant="ghost"
																	size="sm"
																	className="h-7 w-7 p-0 text-destructive"
																>
																	<LogOut className="h-3.5 w-3.5" />
																</Button>
															</AlertDialogTrigger>
															<AlertDialogContent>
																<AlertDialogHeader>
																	<AlertDialogTitle>
																		{messages.LEAVE_ORGANISATION}
																	</AlertDialogTitle>
																	<AlertDialogDescription>
																		{messages.LEAVE_ORGANISATION_CONFIRMATION}
																	</AlertDialogDescription>
																</AlertDialogHeader>
																<AlertDialogFooter>
																	<AlertDialogCancel>
																		{messages.CANCEL}
																	</AlertDialogCancel>
																	<AlertDialogAction onClick={handleLeaveOrg}>
																		{messages.DELETE}
																	</AlertDialogAction>
																</AlertDialogFooter>
															</AlertDialogContent>
														</AlertDialog>
													)}
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</TabsContent>

					{orgPendingInvites.length > 0 && (
						<TabsContent value="pending" className="mt-0 p-4">
							<Table>
								<TableHeader>
									<TableRow className="text-xs">
										<TableHead className="h-8 pl-2">{messages.EMAIL}</TableHead>
										<TableHead className="h-8">{messages.INVITED}</TableHead>
										<TableHead className="h-8 text-right">
											{messages.ACTIONS}
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{orgPendingInvites.map((invite) => (
										<TableRow key={invite.id} className="text-sm">
											<TableCell className="py-2 pl-2">{invite.email}</TableCell>
											<TableCell className="py-2 text-xs text-muted-foreground">
												{new Date(invite.invitedAt).toLocaleDateString()}
											</TableCell>
											<TableCell className="py-2 text-right">
												<Button
													variant="ghost"
													size="sm"
													className="h-7 w-7 p-0 text-destructive"
													onClick={() => handleCancelInvite(invite.id)}
												>
													<X className="h-3.5 w-3.5" />
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</TabsContent>
					)}

					<TabsContent value="all" className="mt-0 p-0 pt-2">
						<Table>
							<TableHeader>
								<TableRow className="text-xs">
									<TableHead className="h-8 pl-2">{messages.NAME}</TableHead>
									<TableHead className="h-8">{messages.MEMBERS}</TableHead>
									<TableHead className="h-8">{messages.STATUS}</TableHead>
									<TableHead className="h-8 text-right">
										{messages.ACTIONS}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{organisations.map((org) => (
									<TableRow key={org.id} className="text-sm">
										<TableCell className="py-2 font-medium pl-2">
											{org.name}
										</TableCell>
										<TableCell className="py-2 text-xs text-muted-foreground">
											{org.memberCount} {messages.MEMBER}
											{org.memberCount !== 1 ? "s" : ""}
										</TableCell>
										<TableCell className="py-2">
											{org.isCurrent ? (
												<Badge className="text-xs h-5 px-2">
													{messages.ACTIVE}
												</Badge>
											) : (
												<span className="text-xs text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell className="py-2 text-right">
											{!org.isCurrent && (
												<Button
													variant="outline"
													size="sm"
													className="h-7 text-xs"
													onClick={() => changeActiveOrganisation(org.id)}
												>
													{messages.SWITCH_ORGANISATION}
												</Button>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TabsContent>
				</Tabs>
			)}

			<CreateOrganisationDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
			/>
		</div>
	);
}
