"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
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
import { Building2, Mail, Check, X, ArrowRight, Users } from "lucide-react";
import { useRootStore } from "@/store";
import {
	getOrganisationPendingInvitations,
	getOrganisationList,
} from "@/selectors/organisation";
import {
	createOrganisation,
	changeActiveOrganisation,
	acceptInvitation,
	declineInvitation,
	fetchOrganisationList,
	fetchPendingInvitations,
} from "@/helpers/client/organisation";
import { postData } from "@/utils/api";
import asaw from "@/utils/asaw";
import getMessage from "@/constants/messages";
import { DEFAULT_LOGGED_IN_ROUTE } from "@/constants/route";

export default function OnboardingPage() {
	const { update: updateSession } = useSession();
	const messages = getMessage();
	const [orgName, setOrgName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [isSkipping, setIsSkipping] = useState(false);
	const [isSelectingOrg, setIsSelectingOrg] = useState<string | null>(null);
	const [isCompleting, setIsCompleting] = useState(false);
	const pendingInvitations = useRootStore(getOrganisationPendingInvitations);
	const organisationList = useRootStore(getOrganisationList);

	// Filter out orgs that are already current (shouldn't happen, but just in case)
	const existingMemberships = organisationList?.filter((org) => !org.isCurrent) || [];

	useEffect(() => {
		// Fetch organisations and invitations on mount
		fetchOrganisationList();
		fetchPendingInvitations();
	}, []);

	const completeOnboardingAndRedirect = async () => {
		// Prevent multiple calls
		if (isCompleting) return;
		setIsCompleting(true);

		const [err] = await asaw(
			postData({
				url: "/api/user/complete-onboarding",
				data: {},
			})
		);

		if (!err) {
			// Trigger session update to refresh the JWT token with hasCompletedOnboarding: true
			await updateSession();
			window.location.href = DEFAULT_LOGGED_IN_ROUTE;
		} else {
			setIsCompleting(false);
		}
	};

	const handleCreateOrganisation = async () => {
		if (!orgName.trim() || isCompleting) return;

		setIsCreating(true);
		const result = await createOrganisation(orgName.trim());

		if (result) {
			await changeActiveOrganisation(result.id);
			await completeOnboardingAndRedirect();
		} else {
			setIsCreating(false);
		}
	};

	const handleSkip = async () => {
		if (isCompleting) return;

		setIsSkipping(true);
		const result = await createOrganisation(messages.PERSONAL_ORGANISATION);

		if (result) {
			await changeActiveOrganisation(result.id);
			await completeOnboardingAndRedirect();
		} else {
			setIsSkipping(false);
		}
	};

	const handleSelectOrganisation = async (orgId: string) => {
		if (isCompleting) return;

		setIsSelectingOrg(orgId);
		await changeActiveOrganisation(orgId);
		await completeOnboardingAndRedirect();
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
		<div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
			<div className="w-full max-w-2xl space-y-6">
				<div className="text-center space-y-2">
					<h1 className="text-3xl font-bold">{messages.ONBOARDING_WELCOME}</h1>
					<p className="text-muted-foreground">{messages.ONBOARDING_SUBTITLE}</p>
				</div>

				{existingMemberships.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Users className="h-5 w-5" />
								{messages.YOUR_ORGANISATIONS}
							</CardTitle>
							<CardDescription>
								{messages.YOUR_ORGANISATIONS_ONBOARDING_DESCRIPTION}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{existingMemberships.map((org) => (
								<div
									key={org.id}
									className="flex items-center justify-between p-3 border rounded-lg"
								>
									<div>
										<p className="font-medium">{org.name}</p>
										<p className="text-sm text-muted-foreground">
											{org.memberCount} {org.memberCount === 1 ? messages.MEMBER : messages.MEMBERS}
										</p>
									</div>
									<Button
										size="sm"
										onClick={() => handleSelectOrganisation(org.id)}
										disabled={isSelectingOrg === org.id}
									>
										{isSelectingOrg === org.id ? (
											messages.SELECTING
										) : (
											<>
												<Check className="h-4 w-4 mr-1" />
												{messages.SELECT}
											</>
										)}
									</Button>
								</div>
							))}
						</CardContent>
					</Card>
				)}

				{pendingInvitations.length > 0 && (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Mail className="h-5 w-5" />
								{messages.PENDING_INVITATIONS}
							</CardTitle>
							<CardDescription>
								{messages.PENDING_INVITATIONS_ONBOARDING_DESCRIPTION}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
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
											{messages.JOIN}
										</Button>
									</div>
								</div>
							))}
						</CardContent>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Building2 className="h-5 w-5" />
							{messages.CREATE_ORGANISATION}
						</CardTitle>
						<CardDescription>
							{messages.ONBOARDING_CREATE_DESCRIPTION}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="org-name">{messages.ORGANISATION_NAME}</Label>
							<Input
								id="org-name"
								placeholder={messages.ORGANISATION_NAME_PLACEHOLDER}
								value={orgName}
								onChange={(e) => setOrgName(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										handleCreateOrganisation();
									}
								}}
							/>
						</div>
						<div className="flex gap-3">
							<Button
								className="flex-1"
								onClick={handleCreateOrganisation}
								disabled={!orgName.trim() || isCreating}
							>
								{isCreating ? messages.CREATING : messages.CREATE_ORGANISATION}
								{!isCreating && <ArrowRight className="h-4 w-4 ml-2" />}
							</Button>
						</div>
					</CardContent>
				</Card>

				<div className="text-center">
					<Button
						variant="ghost"
						onClick={handleSkip}
						disabled={isSkipping}
						className="text-muted-foreground"
					>
						{isSkipping ? messages.SETTING_UP : messages.ONBOARDING_SKIP}
					</Button>
				</div>
			</div>
		</div>
	);
}
