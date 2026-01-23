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
	Building2,
	Mail,
	Check,
	X,
	Trash2,
	UserPlus,
	Crown,
	LogOut,
	Loader2,
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
import { Separator } from "@/components/ui/separator";
import getMessage from "@/constants/messages";

interface Member {
	id: string;
	email: string;
	name: string | null;
	image: string | null;
	isCreator: boolean;
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
		<div className="p-6 space-y-6 overflow-auto w-full">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">Organisation Settings</h1>
					<p className="text-muted-foreground">
						Manage your organisations and team members
					</p>
				</div>
				<Button onClick={() => setCreateDialogOpen(true)}>
					<Building2 className="h-4 w-4 mr-2" />
					New Organisation
				</Button>
			</div>

			{pendingInvitations.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Mail className="h-5 w-5" />
							Pending Invitations
						</CardTitle>
						<CardDescription>
							You have been invited to join the following organisations
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							{pendingInvitations.map((invitation) => (
								<div
									key={invitation.id}
									className="flex items-center justify-between p-3 border rounded-lg"
								>
									<div>
										<p className="font-medium">{invitation.organisationName}</p>
									</div>
									<div className="flex gap-2">
										<Button
											size="sm"
											variant="outline"
											onClick={() => handleDeclineInvitation(invitation.id)}
										>
											<X className="h-4 w-4" />
										</Button>
										<Button
											size="sm"
											onClick={() => handleAcceptInvitation(invitation.id)}
										>
											<Check className="h-4 w-4 mr-1" />
											Join
										</Button>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{currentOrg && (
				<>
					<Card>
						<CardHeader>
							<CardTitle>Current Organisation</CardTitle>
							<CardDescription>
								Update your organisation details
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid gap-2">
								<Label htmlFor="org-name">Organisation Name</Label>
								<div className="flex gap-2">
									<Input
										id="org-name"
										value={orgName}
										onChange={(e) => setOrgName(e.target.value)}
									/>
									<Button
										onClick={handleSaveName}
										disabled={
											isSaving ||
											!orgName.trim() ||
											orgName === currentOrg.name
										}
									>
										{isSaving ? "Saving..." : "Save"}
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<UserPlus className="h-5 w-5" />
								Invite Members
							</CardTitle>
							<CardDescription>
								Invite new members to your organisation
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="flex gap-2">
								<Input
									placeholder="email@example.com"
									type="email"
									value={inviteEmail}
									onChange={(e) => setInviteEmail(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											handleInvite();
										}
									}}
								/>
								<Button
									onClick={handleInvite}
									disabled={isInviting || !inviteEmail.trim()}
								>
									{isInviting ? "Inviting..." : "Invite"}
								</Button>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Members</CardTitle>
							<CardDescription>
								{members.length} member{members.length !== 1 ? "s" : ""} in this
								organisation
							</CardDescription>
						</CardHeader>
						<CardContent>
							{isLoading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2 className="h-6 w-6 animate-spin" />
								</div>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Member</TableHead>
											<TableHead>Role</TableHead>
											<TableHead className="text-right">Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{members.map((member) => (
											<TableRow key={member.id}>
												<TableCell>
													<div>
														<p className="font-medium">
															{member.name || member.email}
														</p>
														{member.name && (
															<p className="text-sm text-muted-foreground">
																{member.email}
															</p>
														)}
													</div>
												</TableCell>
												<TableCell>
													{member.isCreator ? (
														<Badge variant="secondary">
															<Crown className="h-3 w-3 mr-1" />
															Owner
														</Badge>
													) : (
														<Badge variant="outline">Member</Badge>
													)}
												</TableCell>
												<TableCell className="text-right">
													{!member.isCreator && isCreator && (
														<AlertDialog>
															<AlertDialogTrigger asChild>
																<Button
																	variant="ghost"
																	size="sm"
																	className="text-destructive"
																>
																	<Trash2 className="h-4 w-4" />
																</Button>
															</AlertDialogTrigger>
															<AlertDialogContent>
																<AlertDialogHeader>
																	<AlertDialogTitle>
																		Remove Member
																	</AlertDialogTitle>
																	<AlertDialogDescription>
																		Are you sure you want to remove{" "}
																		{member.name || member.email} from this
																		organisation?
																	</AlertDialogDescription>
																</AlertDialogHeader>
																<AlertDialogFooter>
																	<AlertDialogCancel>Cancel</AlertDialogCancel>
																	<AlertDialogAction
																		onClick={() =>
																			handleRemoveMember(member.id)
																		}
																	>
																		Remove
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
																	className="text-destructive"
																>
																	<LogOut className="h-4 w-4" />
																</Button>
															</AlertDialogTrigger>
															<AlertDialogContent>
																<AlertDialogHeader>
																	<AlertDialogTitle>
																		Leave Organisation
																	</AlertDialogTitle>
																	<AlertDialogDescription>
																		Are you sure you want to leave this
																		organisation?
																	</AlertDialogDescription>
																</AlertDialogHeader>
																<AlertDialogFooter>
																	<AlertDialogCancel>Cancel</AlertDialogCancel>
																	<AlertDialogAction onClick={handleLeaveOrg}>
																		Leave
																	</AlertDialogAction>
																</AlertDialogFooter>
															</AlertDialogContent>
														</AlertDialog>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>

					{orgPendingInvites.length > 0 && (
						<Card>
							<CardHeader>
								<CardTitle>Pending Invites</CardTitle>
								<CardDescription>
									Invitations sent but not yet accepted
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Email</TableHead>
											<TableHead>Invited</TableHead>
											<TableHead className="text-right">Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{orgPendingInvites.map((invite) => (
											<TableRow key={invite.id}>
												<TableCell>{invite.email}</TableCell>
												<TableCell>
													{new Date(invite.invitedAt).toLocaleDateString()}
												</TableCell>
												<TableCell className="text-right">
													<Button
														variant="ghost"
														size="sm"
														className="text-destructive"
														onClick={() => handleCancelInvite(invite.id)}
													>
														<X className="h-4 w-4" />
													</Button>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</CardContent>
						</Card>
					)}

					{isCreator && members.length === 1 && (
						<Card className="border-destructive">
							<CardHeader>
								<CardTitle className="text-destructive">Danger Zone</CardTitle>
								<CardDescription>
									Irreversible actions for this organisation
								</CardDescription>
							</CardHeader>
							<CardContent>
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button variant="destructive">
											<Trash2 className="h-4 w-4 mr-2" />
											Delete Organisation
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Delete Organisation</AlertDialogTitle>
											<AlertDialogDescription>
												Are you sure you want to delete &ldquo;{currentOrg.name}
												&rdquo;? This action cannot be undone.
											</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction onClick={handleDeleteOrg}>
												Delete
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							</CardContent>
						</Card>
					)}
				</>
			)}

			<Separator />

			<Card>
				<CardHeader>
					<CardTitle>Your Organisations</CardTitle>
					<CardDescription>
						All organisations you are a member of
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Members</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{organisations.map((org) => (
								<TableRow key={org.id}>
									<TableCell className="font-medium">{org.name}</TableCell>
									<TableCell>
										{org.memberCount} member{org.memberCount !== 1 ? "s" : ""}
									</TableCell>
									<TableCell>
										{org.isCurrent ? (
											<Badge>Active</Badge>
										) : (
											<Badge variant="outline">-</Badge>
										)}
									</TableCell>
									<TableCell className="text-right">
										{!org.isCurrent && (
											<Button
												variant="outline"
												size="sm"
												onClick={() => changeActiveOrganisation(org.id)}
											>
												Switch
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<CreateOrganisationDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
			/>
		</div>
	);
}
