import prisma from "./prisma";
import { getCurrentUser } from "./session";
import getMessage from "@/constants/messages";
import { throwIfError } from "@/utils/error";

/**
 * Generate a URL-safe slug from a name
 */
export function generateOrganisationSlug(name: string): string {
	const baseSlug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

	// Add a random suffix for uniqueness
	const randomSuffix = Math.random().toString(36).substring(2, 8);
	return `${baseSlug}-${randomSuffix}`;
}

/**
 * Generate a unique organisation slug with retry logic
 */
async function generateUniqueOrganisationSlug(
	name: string,
	maxRetries: number = 10
): Promise<string> {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const slug = generateOrganisationSlug(name);

		// Check if slug already exists
		const existing = await prisma.organisation.findUnique({
			where: { slug },
			select: { id: true },
		});

		if (!existing) {
			return slug;
		}
	}

	// If we've exhausted all retries, throw a meaningful error
	throw new Error(
		"Unable to generate a unique organisation slug. Please try again or use a different name."
	);
}

/**
 * Check if a user has admin or owner role in an organisation
 */
async function hasAdminOrOwnerRole(
	organisationId: string,
	userId: string
): Promise<boolean> {
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId,
			},
		},
		select: { role: true },
	});

	if (!membership) return false;

	// Owner or admin have elevated permissions
	return membership.role === "owner" || membership.role === "admin";
}

/**
 * Get a user's role in an organisation
 */
async function getUserRoleInOrganisation(
	organisationId: string,
	userId: string
): Promise<string | null> {
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId,
			},
		},
		select: { role: true },
	});

	return membership?.role || null;
}

/**
 * Create a new organisation
 */
export async function createOrganisation(name: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const slug = await generateUniqueOrganisationSlug(name);

	const organisation = await prisma.organisation.create({
		data: {
			name,
			slug,
			createdByUserId: user!.id,
		},
	});

	// Add creator as a member with owner role
	await prisma.organisationUser.create({
		data: {
			organisationId: organisation.id,
			userId: user!.id,
			role: "owner",
			isCurrent: false, // Don't auto-switch to new org
		},
	});

	// Migrate orphaned configs and shared users to the new org
	await migrateUserConfigsToOrganisation(organisation.id, user!.id);

	return organisation;
}

/**
 * Get all organisations for the current user
 */
export async function getOrganisationsByUser() {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const orgUsers = await prisma.organisationUser.findMany({
		where: {
			userId: user!.id,
		},
		include: {
			organisation: {
				include: {
					_count: {
						select: { members: true },
					},
				},
			},
		},
		orderBy: {
			organisation: {
				createdAt: "asc",
			},
		},
	});

	return orgUsers.map((orgUser) => ({
		id: orgUser.organisation.id,
		name: orgUser.organisation.name,
		slug: orgUser.organisation.slug,
		isCurrent: orgUser.isCurrent,
		memberCount: orgUser.organisation._count.members,
		createdByUserId: orgUser.organisation.createdByUserId,
	}));
}

/**
 * Get the current active organisation for a user
 */
export async function getCurrentOrganisation() {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const orgUser = await prisma.organisationUser.findFirst({
		where: {
			userId: user!.id,
			isCurrent: true,
		},
		include: {
			organisation: {
				include: {
					_count: {
						select: { members: true },
					},
				},
			},
		},
	});

	if (!orgUser) {
		return null;
	}

	return {
		id: orgUser.organisation.id,
		name: orgUser.organisation.name,
		slug: orgUser.organisation.slug,
		isCurrent: true,
		memberCount: orgUser.organisation._count.members,
		createdByUserId: orgUser.organisation.createdByUserId,
	};
}

/**
 * Set the current organisation for a user
 */
export async function setCurrentOrganisation(organisationId: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	// Verify user is a member of the organisation
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId: user!.id,
			},
		},
	});

	throwIfError(!membership, getMessage().NOT_ORGANISATION_MEMBER);

	// Atomically unset all current orgs and set the new one in a transaction
	// This prevents a race condition where concurrent requests could see
	// no current organisation between the two operations
	await prisma.$transaction([
		// Unset all current orgs for this user
		prisma.organisationUser.updateMany({
			where: {
				userId: user!.id,
				isCurrent: true,
			},
			data: {
				isCurrent: false,
			},
		}),
		// Set the new current org
		prisma.organisationUser.update({
			where: {
				organisationId_userId: {
					organisationId,
					userId: user!.id,
				},
			},
			data: {
				isCurrent: true,
			},
		}),
	]);

	return { success: true };
}

/**
 * Update organisation details
 */
export async function updateOrganisation(
	id: string,
	data: { name?: string }
) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	// Verify user has admin or owner role
	const hasPermission = await hasAdminOrOwnerRole(id, user!.id);
	throwIfError(!hasPermission, getMessage().ONLY_ADMIN_CAN_UPDATE_ORGANISATION);

	const updateData: { name?: string } = {};
	if (data.name) {
		updateData.name = data.name;
	}

	if (Object.keys(updateData).length === 0) {
		throw new Error(getMessage().ORGANISATION_NOTHING_TO_UPDATE);
	}

	return await prisma.organisation.update({
		where: { id },
		data: updateData,
	});
}

/**
 * Delete an organisation (only if creator and sole member)
 */
export async function deleteOrganisation(id: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const organisation = await prisma.organisation.findUnique({
		where: { id },
		include: {
			_count: {
				select: { members: true },
			},
		},
	});

	throwIfError(!organisation, getMessage().ORGANISATION_NOT_FOUND);
	throwIfError(
		organisation!.createdByUserId !== user!.id,
		getMessage().ORGANISATION_ONLY_CREATOR_CAN_DELETE
	);
	throwIfError(
		organisation!._count.members > 1,
		getMessage().ORGANISATION_CANNOT_DELETE_WITH_MEMBERS
	);

	// Check if this is the user's current organisation before deletion
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId: id,
				userId: user!.id,
			},
		},
	});

	const wasCurrentOrg = membership?.isCurrent;

	// Delete the organisation (cascade will handle members)
	await prisma.organisation.delete({
		where: { id },
	});

	// If this was the user's current org, set another org as current
	if (wasCurrentOrg) {
		const remainingOrgs = await prisma.organisationUser.findFirst({
			where: {
				userId: user!.id,
			},
			orderBy: {
				createdAt: "asc", // Set the oldest org as current
			},
		});

		if (remainingOrgs) {
			await prisma.organisationUser.update({
				where: {
					id: remainingOrgs.id,
				},
				data: {
					isCurrent: true,
				},
			});
		}
	}

	return { success: true };
}

/**
 * Invite a user to an organisation
 */
export async function inviteUserToOrganisation(
	organisationId: string,
	email: string
) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	// Verify inviter has admin or owner role
	const hasPermission = await hasAdminOrOwnerRole(organisationId, user!.id);
	throwIfError(!hasPermission, getMessage().ONLY_ADMIN_CAN_INVITE);

	// Validate and normalize email
	const normalizedEmail = email.toLowerCase().trim();
	
	// Validate email is not empty
	if (!normalizedEmail) {
		throw new Error("Email cannot be empty");
	}
	
	// Validate email format - using a safer regex pattern that avoids ReDoS
	// This pattern is more restrictive but safe from catastrophic backtracking
	const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
	if (!EMAIL_REGEX.test(normalizedEmail)) {
		throw new Error("Invalid email format");
	}

	// Check if user already exists
	const existingUser = await prisma.user.findUnique({
		where: { email: normalizedEmail },
	});

	if (existingUser) {
		// Check if already a member
		const existingMembership = await prisma.organisationUser.findUnique({
			where: {
				organisationId_userId: {
					organisationId,
					userId: existingUser.id,
				},
			},
		});

		if (existingMembership) {
			throw new Error(getMessage().USER_ALREADY_ORGANISATION_MEMBER);
		}

		// Add them directly as a member
		await prisma.organisationUser.create({
			data: {
				organisationId,
				userId: existingUser.id,
				role: "member",
				isCurrent: false,
			},
		});

		// Share all organisation database configs with the new member
		await shareOrganisationDatabaseConfigs(organisationId, existingUser.id);

		return { added: true, invited: false };
	}

	// Check if already invited
	const existingInvite = await prisma.organisationInvitedUser.findUnique({
		where: {
			organisationId_email: {
				organisationId,
				email: normalizedEmail,
			},
		},
	});

	if (existingInvite) {
		throw new Error(getMessage().USER_ALREADY_INVITED);
	}

	// Create invitation
	await prisma.organisationInvitedUser.create({
		data: {
			organisationId,
			email: normalizedEmail,
			invitedByUserId: user!.id,
		},
	});

	return { added: false, invited: true };
}

/**
 * Get pending invitations for a user
 */
export async function getPendingInvitationsForUser() {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	// Normalize email to lowercase for case-insensitive comparison
	const normalizedEmail = user!.email.toLowerCase().trim();

	const invitations = await prisma.organisationInvitedUser.findMany({
		where: {
			email: normalizedEmail,
		},
		include: {
			organisation: true,
		},
	});

	return invitations.map((invite) => ({
		id: invite.id,
		organisationId: invite.organisationId,
		organisationName: invite.organisation.name,
		invitedByUserId: invite.invitedByUserId,
		createdAt: invite.createdAt,
	}));
}

/**
 * Accept an invitation
 */
export async function acceptInvitation(invitationId: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const invitation = await prisma.organisationInvitedUser.findUnique({
		where: { id: invitationId },
	});

	throwIfError(!invitation, getMessage().INVITATION_NOT_FOUND);
	
	// Normalize both emails to lowercase for case-insensitive comparison
	const normalizedInvitationEmail = invitation!.email.toLowerCase().trim();
	const normalizedUserEmail = user!.email.toLowerCase().trim();
	
	throwIfError(
		normalizedInvitationEmail !== normalizedUserEmail,
		getMessage().INVITATION_NOT_FOR_YOU
	);

	// Create membership
	await prisma.organisationUser.create({
		data: {
			organisationId: invitation!.organisationId,
			userId: user!.id,
			role: "member",
			isCurrent: false,
		},
	});

	// Share all organisation database configs with the new member
	await shareOrganisationDatabaseConfigs(invitation!.organisationId, user!.id);

	// Delete invitation
	await prisma.organisationInvitedUser.delete({
		where: { id: invitationId },
	});

	return { success: true };
}

/**
 * Decline an invitation
 */
export async function declineInvitation(invitationId: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const invitation = await prisma.organisationInvitedUser.findUnique({
		where: { id: invitationId },
	});

	throwIfError(!invitation, getMessage().INVITATION_NOT_FOUND);
	
	// Normalize both emails to lowercase for case-insensitive comparison
	const normalizedInvitationEmail = invitation!.email.toLowerCase().trim();
	const normalizedUserEmail = user!.email.toLowerCase().trim();
	
	throwIfError(
		normalizedInvitationEmail !== normalizedUserEmail,
		getMessage().INVITATION_NOT_FOR_YOU
	);

	await prisma.organisationInvitedUser.delete({
		where: { id: invitationId },
	});

	return { success: true };
}

/**
 * Move pending invitations to membership when a user is created
 */
export async function moveInvitationsToMembership(
	email: string,
	userId: string
) {
	// Normalize email to lowercase for case-insensitive comparison
	const normalizedEmail = email.toLowerCase().trim();
	
	const invitations = await prisma.organisationInvitedUser.findMany({
		where: { email: normalizedEmail },
	});

	for (const invitation of invitations) {
		// Create membership
		await prisma.organisationUser.create({
			data: {
				organisationId: invitation.organisationId,
				userId,
				role: "member",
				isCurrent: false,
			},
		});

		// Share all organisation database configs with the new member
		await shareOrganisationDatabaseConfigs(invitation.organisationId, userId);

		// Delete invitation
		await prisma.organisationInvitedUser.delete({
			where: { id: invitation.id },
		});
	}
}

/**
 * Remove a user from an organisation
 */
export async function removeUserFromOrganisation(
	organisationId: string,
	userId: string
) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const organisation = await prisma.organisation.findUnique({
		where: { id: organisationId },
	});

	throwIfError(!organisation, getMessage().ORGANISATION_NOT_FOUND);

	// Check if user removing themselves
	const isSelfRemoval = userId === user!.id;

	if (isSelfRemoval) {
		// Creator cannot remove themselves at all
		if (userId === organisation!.createdByUserId) {
			const memberCount = await prisma.organisationUser.count({
				where: { organisationId },
			});
			if (memberCount > 1) {
				throw new Error(getMessage().CANNOT_LEAVE_WITH_MEMBERS);
			} else {
				// memberCount === 1, they are the sole member
				throw new Error(getMessage().CREATOR_CANNOT_LEAVE_ALONE);
			}
		}
		// Regular members and admins can remove themselves
	} else {
		// Removing someone else - need admin or owner permissions
		const currentUserRole = await getUserRoleInOrganisation(
			organisationId,
			user!.id
		);
		throwIfError(
			!currentUserRole,
			getMessage().NOT_ORGANISATION_MEMBER
		);

		const targetUserRole = await getUserRoleInOrganisation(
			organisationId,
			userId
		);

		// Only admins and owners can remove other members
		const hasPermission =
			currentUserRole === "owner" || currentUserRole === "admin";
		throwIfError(
			!hasPermission,
			getMessage().ONLY_ADMIN_CAN_REMOVE_MEMBERS
		);

		// Only owner can remove admins or other owners
		if (
			(targetUserRole === "admin" || targetUserRole === "owner") &&
			currentUserRole !== "owner"
		) {
			throw new Error(getMessage().CANNOT_REMOVE_ADMIN_OR_OWNER);
		}

		// Owner cannot be removed
		if (userId === organisation!.createdByUserId) {
			throw new Error(getMessage().CANNOT_REMOVE_ADMIN_OR_OWNER);
		}
	}

	// Check if this is the user's current organisation
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId,
			},
		},
	});

	const wasCurrentOrg = membership?.isCurrent;

	// Remove user from all database configs in this organisation
	await prisma.databaseConfigUser.deleteMany({
		where: {
			userId,
			databaseConfig: {
				organisationId,
			},
		},
	});

	// Remove user from organisation
	await prisma.organisationUser.delete({
		where: {
			organisationId_userId: {
				organisationId,
				userId,
			},
		},
	});

	// If this was the user's current org, set another org as current
	if (wasCurrentOrg) {
		const remainingOrgs = await prisma.organisationUser.findFirst({
			where: {
				userId,
			},
			orderBy: {
				createdAt: "asc", // Set the oldest org as current
			},
		});

		if (remainingOrgs) {
			await prisma.organisationUser.update({
				where: {
					id: remainingOrgs.id,
				},
				data: {
					isCurrent: true,
				},
			});
		}
	}

	return { success: true };
}

/**
 * Get members of an organisation
 */
export async function getOrganisationMembers(organisationId: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	// Verify user is a member
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId: user!.id,
			},
		},
	});

	throwIfError(!membership, getMessage().NOT_ORGANISATION_MEMBER);

	const members = await prisma.organisationUser.findMany({
		where: { organisationId },
		include: {
			user: {
				select: {
					id: true,
					email: true,
					name: true,
					image: true,
				},
			},
		},
		orderBy: {
			createdAt: "asc",
		},
	});

	const organisation = await prisma.organisation.findUnique({
		where: { id: organisationId },
	});

	return members.map((member) => ({
		id: member.user.id,
		email: member.user.email,
		name: member.user.name,
		image: member.user.image,
		isCreator: member.user.id === organisation!.createdByUserId,
		role: member.user.id === organisation!.createdByUserId ? "owner" : member.role,
		joinedAt: member.createdAt,
	}));
}

/**
 * Update member role in an organisation
 */
export async function updateMemberRole(
	organisationId: string,
	userId: string,
	role: string
) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const organisation = await prisma.organisation.findUnique({
		where: { id: organisationId },
	});

	throwIfError(!organisation, getMessage().ORGANISATION_NOT_FOUND);

	// Validate role
	throwIfError(
		!["member", "admin"].includes(role),
		getMessage().INVALID_MEMBER_ROLE
	);

	// Cannot change owner's role
	throwIfError(
		userId === organisation!.createdByUserId,
		getMessage().CANNOT_CHANGE_OWNER_ROLE
	);

	// Get current user's role
	const currentUserRole = await getUserRoleInOrganisation(
		organisationId,
		user!.id
	);
	throwIfError(!currentUserRole, getMessage().NOT_ORGANISATION_MEMBER);

	// Get target user's current role
	const targetUserRole = await getUserRoleInOrganisation(
		organisationId,
		userId
	);
	throwIfError(!targetUserRole, getMessage().NOT_ORGANISATION_MEMBER);

	// Only admins and owners can update roles
	const hasPermission =
		currentUserRole === "owner" || currentUserRole === "admin";
	throwIfError(!hasPermission, getMessage().ONLY_ADMIN_OR_OWNER_CAN_UPDATE_ROLES);

	// Only owner can change admin roles (demote admin to member)
	// Admins can promote members to admin
	if (targetUserRole === "admin") {
		throwIfError(
			currentUserRole !== "owner",
			getMessage().CANNOT_CHANGE_ADMIN_ROLE
		);
	}

	await prisma.organisationUser.update({
		where: {
			organisationId_userId: {
				organisationId,
				userId,
			},
		},
		data: {
			role,
		},
	});

	return { success: true };
}

/**
 * Get pending invites for an organisation
 */
export async function getOrganisationPendingInvites(organisationId: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	// Verify user is a member
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId: user!.id,
			},
		},
	});

	throwIfError(!membership, getMessage().NOT_ORGANISATION_MEMBER);

	const invites = await prisma.organisationInvitedUser.findMany({
		where: { organisationId },
		orderBy: {
			createdAt: "desc",
		},
	});

	return invites.map((invite) => ({
		id: invite.id,
		email: invite.email,
		invitedAt: invite.createdAt,
	}));
}

/**
 * Cancel an invitation
 */
export async function cancelInvitation(invitationId: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const invitation = await prisma.organisationInvitedUser.findUnique({
		where: { id: invitationId },
		include: { organisation: true },
	});

	throwIfError(!invitation, getMessage().INVITATION_NOT_FOUND);

	// Verify user has admin or owner role
	const hasPermission = await hasAdminOrOwnerRole(
		invitation!.organisationId,
		user!.id
	);
	throwIfError(!hasPermission, getMessage().ONLY_ADMIN_CAN_CANCEL_INVITATION);

	await prisma.organisationInvitedUser.delete({
		where: { id: invitationId },
	});

	return { success: true };
}

/**
 * Get organisation by ID
 */
export async function getOrganisationById(id: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	// Verify user is a member
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId: id,
				userId: user!.id,
			},
		},
	});

	throwIfError(!membership, getMessage().NOT_ORGANISATION_MEMBER);

	const organisation = await prisma.organisation.findUnique({
		where: { id },
		include: {
			_count: {
				select: { members: true },
			},
		},
	});

	if (!organisation) {
		return null;
	}

	return {
		id: organisation.id,
		name: organisation.name,
		slug: organisation.slug,
		isCurrent: membership!.isCurrent,
		memberCount: organisation._count.members,
		createdByUserId: organisation.createdByUserId,
	};
}

/**
 * Migrate a user's orphaned DB configs to an organisation.
 * Also adds users who share those configs as members of the org.
 */
async function migrateUserConfigsToOrganisation(
	organisationId: string,
	userId: string
) {
	// Find all orphaned DB configs the user has access to
	const userConfigLinks = await prisma.databaseConfigUser.findMany({
		where: {
			userId,
			databaseConfig: {
				organisationId: null,
			},
		},
		select: { databaseConfigId: true },
	});

	if (userConfigLinks.length === 0) return;

	const orphanedConfigIds = userConfigLinks.map(
		(link) => link.databaseConfigId
	);

	// Move those configs to the new org
	await prisma.databaseConfig.updateMany({
		where: { id: { in: orphanedConfigIds } },
		data: { organisationId },
	});

	// Find other users who share those configs
	const sharedUserLinks = await prisma.databaseConfigUser.findMany({
		where: {
			databaseConfigId: { in: orphanedConfigIds },
			userId: { not: userId },
		},
		select: { userId: true },
		distinct: ["userId"],
	});

	for (const { userId: sharedUserId } of sharedUserLinks) {
		// Check if already a member
		const existingMembership = await prisma.organisationUser.findUnique({
			where: {
				organisationId_userId: {
					organisationId,
					userId: sharedUserId,
				},
			},
		});

		// Check if the user already has a current org
		const hasCurrentOrg = await prisma.organisationUser.findFirst({
			where: { userId: sharedUserId, isCurrent: true },
		});

		if (!existingMembership) {
			await prisma.organisationUser.create({
				data: {
					organisationId,
					userId: sharedUserId,
					role: "member",
					isCurrent: !hasCurrentOrg,
				},
			});
		} else if (!hasCurrentOrg) {
			// Existing membership but no current org — fix it
			await prisma.organisationUser.update({
				where: {
					organisationId_userId: {
						organisationId,
						userId: sharedUserId,
					},
				},
				data: { isCurrent: true },
			});
		}

		// Share org DB configs with the new member
		await shareOrganisationDatabaseConfigs(organisationId, sharedUserId);

		// Mark as onboarded
		await prisma.user.update({
			where: { id: sharedUserId },
			data: { hasCompletedOnboarding: true },
		});
	}
}

/**
 * Share all database configs in an organisation with a user
 */
async function shareOrganisationDatabaseConfigs(
	organisationId: string,
	userId: string
) {
	// Get all database configs for this organisation
	const databaseConfigs = await prisma.databaseConfig.findMany({
		where: { organisationId },
		orderBy: {
			createdAt: "asc",
		},
	});

	if (databaseConfigs.length === 0) return;

	// Check if user has any current database config in THIS organisation
	const existingCurrentConfig = await prisma.databaseConfigUser.findFirst({
		where: {
			userId,
			isCurrent: true,
			databaseConfig: {
				organisationId,
			},
		},
	});
	let hasAssignedCurrentToNewShare = false;

	// Add user to each database config with view permissions
	for (let i = 0; i < databaseConfigs.length; i++) {
		const config = databaseConfigs[i];
		
		// Check if user already has access
		const existingAccess = await prisma.databaseConfigUser.findUnique({
			where: {
				databaseConfigId_userId: {
					databaseConfigId: config.id,
					userId,
				},
			},
		});

		// Only add if they don't already have access
		if (!existingAccess) {
			// Set the first config actually shared as current if user has no current config
			const shouldBeCurrent =
				!existingCurrentConfig && !hasAssignedCurrentToNewShare;

			await prisma.databaseConfigUser.create({
				data: {
					databaseConfigId: config.id,
					userId,
					isCurrent: shouldBeCurrent,
					canEdit: false,
					canShare: false,
					canDelete: false,
				},
			});

			if (shouldBeCurrent) {
				hasAssignedCurrentToNewShare = true;
			}
		}
	}
}
