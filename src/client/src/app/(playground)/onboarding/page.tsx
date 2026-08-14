"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
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
	Building2,
	Mail,
	Check,
	X,
	ArrowRight,
	Users,
	FolderKanban,
	Database,
	Plus,
	Sparkles,
} from "lucide-react";
import { useRootStore } from "@/store";
import {
	getOrganisationPendingInvitations,
	getOrganisationList,
	getCurrentOrganisation,
	getOrganisationIsLoading,
} from "@/selectors/organisation";
import {
	getCurrentProject,
	getProjectIsLoading,
	getProjectList,
} from "@/selectors/project";
import {
	getDatabaseConfigList,
	getDatabaseConfigListIsLoading,
} from "@/selectors/database-config";
import {
	acceptInvitation,
	declineInvitation,
	fetchOrganisationList,
	fetchPendingInvitations,
} from "@/helpers/client/organisation";
import { fetchProjectList } from "@/helpers/client/project";
import { fetchDatabaseConfigList } from "@/helpers/client/database-config";
import { postData } from "@/utils/api";
import asaw from "@/utils/asaw";
import getMessage from "@/constants/messages";
import { DEFAULT_LOGGED_IN_ROUTE } from "@/constants/route";
import Link from "next/link";
import Loader from "@/components/common/loader";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";

function TimelineStep({
	active,
	complete,
	description,
	icon,
	isLast,
	stepNumber,
	title,
	children,
}: {
	active?: boolean;
	complete?: boolean;
	description: string;
	icon: ReactNode;
	isLast?: boolean;
	stepNumber: number;
	title: string;
	children?: ReactNode;
}) {
	return (
		<div className="relative flex gap-4">
			<div className="relative flex w-9 shrink-0 justify-center">
				{!isLast ? (
					<div
						className={`absolute bottom-[-1rem] top-10 w-px ${
							complete
								? "bg-primary/70"
								: "bg-stone-200 dark:bg-stone-800"
						}`}
					/>
				) : null}
				<div
					className={`z-10 flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold shadow-sm transition-colors ${
						complete
							? "border-primary bg-primary text-primary-foreground"
							: active
								? "border-primary bg-primary/10 text-primary dark:bg-primary/15"
								: "border-stone-300 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-400"
					}`}
				>
					{complete ? <Check className="h-4 w-4" /> : stepNumber}
				</div>
			</div>
			<div
				className={`min-w-0 flex-1 rounded-xl border p-4 shadow-sm transition-colors ${
					active
						? "border-primary/50 bg-primary/5 dark:border-primary/60 dark:bg-primary/10"
						: complete
							? "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950"
							: "border-stone-200 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-900/40"
				}`}
			>
				<div className="flex items-start gap-3">
					<div
						className={`rounded-lg border p-2 ${
							active || complete
								? "border-primary/20 bg-primary/10 text-primary dark:border-primary/30"
								: "border-stone-200 bg-white text-stone-500 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400"
						}`}
					>
						{icon}
					</div>
					<div className="min-w-0 flex-1">
						<h3 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
							{title}
						</h3>
						<p className="mt-1 text-sm leading-6 text-stone-600 dark:text-stone-300">
							{description}
						</p>
						{children ? <div className="mt-3">{children}</div> : null}
					</div>
				</div>
			</div>
		</div>
	);
}

export default function OnboardingPage() {
	const posthog = usePostHog();
	const { update: updateSession } = useSession();
	const messages = getMessage();
	const [orgName, setOrgName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [isSkipping, setIsSkipping] = useState(false);
	const [isSelectingOrg, setIsSelectingOrg] = useState<string | null>(null);
	const [isCompleting, setIsCompleting] = useState(false);
	const [hasLoadedOrganisations, setHasLoadedOrganisations] = useState(false);
	const [projectName, setProjectName] = useState("");
	const [isCreatingProject, setIsCreatingProject] = useState(false);
	const pendingInvitations = useRootStore(getOrganisationPendingInvitations);
	const organisationList = useRootStore(getOrganisationList);
	const currentOrg = useRootStore(getCurrentOrganisation);
	const isOrganisationLoading = useRootStore(getOrganisationIsLoading);
	const projects = useRootStore(getProjectList);
	const currentProject = useRootStore(getCurrentProject);
	const isProjectLoading = useRootStore(getProjectIsLoading);
	const databaseConfigs = useRootStore(getDatabaseConfigList);
	const isDatabaseConfigLoading = useRootStore(getDatabaseConfigListIsLoading);
	const hasProject = Boolean(currentProject?.id && (projects?.length || 0) > 0);
	const hasDbConfig = Boolean(databaseConfigs?.length);
	const isSetupComplete = Boolean(currentOrg?.id && hasProject && hasDbConfig);
	const isInitialising =
		!currentOrg?.id &&
		(!hasLoadedOrganisations || isOrganisationLoading || organisationList === undefined);

	// Filter out orgs that are already current (shouldn't happen, but just in case)
	const existingMemberships = organisationList?.filter((org) => !org.isCurrent) || [];

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.ONBOARDING_PAGE_VISITED);
		let isMounted = true;
		Promise.all([fetchOrganisationList(), fetchPendingInvitations()]).finally(() => {
			if (isMounted) setHasLoadedOrganisations(true);
		});
		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		if (currentOrg?.id) {
			fetchProjectList(currentOrg.id);
		}
	}, [currentOrg?.id]);

	useEffect(() => {
		if (currentProject?.id) {
			fetchDatabaseConfigList(() => {});
		}
	}, [currentProject?.id]);

	const handleCreateProject = async () => {
		if (!currentOrg?.id || !projectName.trim()) return;
		setIsCreatingProject(true);
		const [err, data] = await asaw(
			postData({
				url: `/api/organisation/${currentOrg.id}/projects`,
				data: { name: projectName.trim() },
			})
		);
		setIsCreatingProject(false);

		if (err || data?.err) return;
		posthog?.group("project", data.id);
		posthog?.capture(CLIENT_EVENTS.PROJECT_CREATED, {
			organisation_id: currentOrg.id,
			project_id: data.id,
		});
		setProjectName("");
		await fetchProjectList(currentOrg.id);
	};

	const setCurrentOrgAndComplete = async (orgId: string) => {
		// Prevent multiple calls
		if (isCompleting) return false;
		setIsCompleting(true);

		// Set current org via API directly (skip DB config fetch/ping for speed)
		const [setOrgErr] = await asaw(
			postData({ url: `/api/organisation/current/${orgId}`, data: {} })
		);
		if (setOrgErr) {
			setIsCompleting(false);
			return false;
		}

		// Mark onboarding complete
		const [completeErr] = await asaw(
			postData({ url: "/api/user/complete-onboarding", data: {} })
		);
		if (completeErr) {
			setIsCompleting(false);
			return false;
		}

		// Refresh JWT token and redirect — home page AppInit will load DB configs
		await updateSession();
		window.location.href = DEFAULT_LOGGED_IN_ROUTE;
		return true;
	};

	const handleCreateOrganisation = async () => {
		if (!orgName.trim() || isCompleting) return;

		setIsCreating(true);
		try {
			const [err, result] = await asaw(
				postData({ url: "/api/organisation", data: { name: orgName.trim() } })
			);

			if (err || !result?.id) {
				return;
			}

			await setCurrentOrgAndComplete(result.id);
		} finally {
			setIsCreating(false);
		}
	};

	const handleSkip = async () => {
		if (isCompleting) return;

		setIsSkipping(true);
		try {
			const [err, result] = await asaw(
				postData({
					url: "/api/organisation",
					data: { name: messages.PERSONAL_ORGANISATION },
				})
			);

			if (err || !result?.id) {
				return;
			}

			await setCurrentOrgAndComplete(result.id);
		} finally {
			setIsSkipping(false);
		}
	};

	const handleSelectOrganisation = async (orgId: string) => {
		if (isCompleting) return;

		setIsSelectingOrg(orgId);
		try {
			await setCurrentOrgAndComplete(orgId);
		} finally {
			setIsSelectingOrg(null);
		}
	};

	const handleAcceptInvitation = async (invitation: {
		id: string;
		organisationId: string;
	}) => {
		if (isCompleting) return;

		setIsSelectingOrg(invitation.organisationId);
		try {
			const accepted = await acceptInvitation(invitation.id);
			if (accepted) {
				await setCurrentOrgAndComplete(invitation.organisationId);
			}
		} finally {
			setIsSelectingOrg(null);
		}
	};

	const handleDeclineInvitation = async (invitationId: string) => {
		await declineInvitation(invitationId);
	};

	if (isInitialising) {
		return (
			<div className="flex min-h-screen w-full items-center justify-center bg-background">
				<Loader />
			</div>
		);
	}

	return (
		<div className="h-full w-full overflow-y-auto bg-stone-50 p-2 text-stone-950 dark:bg-stone-950 dark:text-stone-50 md:p-3">
			<div className="w-full space-y-3">
				<FeaturePageHeader
					eyebrow={messages.ONBOARDING}
					title={messages.ONBOARDING_WELCOME}
					description={messages.ONBOARDING_SUBTITLE}
					icon={<Sparkles className="h-4 w-4" />}
					tone="border-primary/20 bg-primary/10 text-primary dark:border-primary/30"
				/>

				{currentOrg?.id && (
					<Card className="overflow-hidden border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
						<CardHeader className="border-b border-stone-100 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-950/60">
							<CardTitle className="text-stone-950 dark:text-stone-50">
								{messages.HOME_SETUP_TITLE}
							</CardTitle>
							<CardDescription className="text-stone-600 dark:text-stone-300">
								{messages.HOME_SETUP_DESCRIPTION}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4 p-5">
							<TimelineStep
								complete
								description={currentOrg.name}
								icon={<Building2 className="h-4 w-4" />}
								stepNumber={1}
								title={messages.HOME_SETUP_ORGANISATION_STEP}
							/>
							<TimelineStep
								active={!hasProject}
								complete={hasProject}
								description={messages.HOME_SETUP_PROJECT_DESCRIPTION}
								icon={<FolderKanban className="h-4 w-4" />}
								stepNumber={2}
								title={messages.HOME_SETUP_PROJECT_STEP}
							>
								{!hasProject ? (
									<div className="flex gap-2">
										<Input
											value={projectName}
											onChange={(event) => setProjectName(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") handleCreateProject();
											}}
											placeholder={messages.PROJECT_NAME_PLACEHOLDER}
											className="h-9"
											disabled={isProjectLoading}
										/>
										<Button
											onClick={handleCreateProject}
											disabled={isCreatingProject || !projectName.trim()}
											size="sm"
											className="h-9 shrink-0"
										>
											<Plus className="mr-1.5 h-3.5 w-3.5" />
											{messages.CREATE_ORGANISATION_PROJECT}
										</Button>
									</div>
								) : null}
							</TimelineStep>
							<TimelineStep
								active={hasProject && !hasDbConfig}
								complete={hasDbConfig}
								description={messages.HOME_SETUP_DB_CONFIG_DESCRIPTION}
								icon={<Database className="h-4 w-4" />}
								stepNumber={3}
								title={messages.HOME_SETUP_DB_CONFIG_STEP}
							>
								{hasProject && !hasDbConfig && currentProject?.id ? (
									<Button asChild size="sm" className="h-9">
										<Link href={`/organisation/project/${currentProject.id}?tab=database`}>
											<Database className="mr-1.5 h-3.5 w-3.5" />
											{isDatabaseConfigLoading
												? messages.LOADING
												: messages.ADD_NEW_CONFIG}
										</Link>
									</Button>
								) : null}
							</TimelineStep>
							<TimelineStep
								active={isSetupComplete}
								complete={isSetupComplete}
								description={messages.HOME_SETUP_READY_DESCRIPTION}
								icon={<Sparkles className="h-4 w-4" />}
								isLast
								stepNumber={4}
								title={messages.HOME_SETUP_READY_STEP}
							/>
						</CardContent>
					</Card>
				)}

				{!currentOrg?.id && existingMemberships.length > 0 && (
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
									className="flex items-center justify-between p-3 border border-stone-200 dark:border-stone-800 rounded-lg"
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

				{!currentOrg?.id && pendingInvitations.length > 0 && (
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
									className="flex items-center justify-between p-3 border border-stone-200 dark:border-stone-800 rounded-lg"
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
											onClick={() => handleAcceptInvitation(invitation)}
											disabled={isCompleting || isSelectingOrg === invitation.organisationId}
										>
											{isSelectingOrg === invitation.organisationId ? (
												messages.LOADING
											) : (
												<>
													<Check className="h-4 w-4 mr-1" />
													{messages.JOIN}
												</>
											)}
										</Button>
									</div>
								</div>
							))}
						</CardContent>
					</Card>
				)}

				{!currentOrg?.id && (
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
				)}

				{!currentOrg?.id && (
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
				)}
			</div>
		</div>
	);
}
