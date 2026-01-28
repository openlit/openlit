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
 * Create a new organisation
 */
export async function createOrganisation(name: string) {
	const user = await getCurrentUser();
	throwIfError(!user, getMessage().UNAUTHORIZED_USER);

	const slug = generateOrganisationSlug(name);

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

	throwIfError(!membership, "You are not a member of this organisation");

	// Unset all current orgs for this user
	await prisma.organisationUser.updateMany({
		where: {
			userId: user!.id,
			isCurrent: true,
		},
		data: {
			isCurrent: false,
		},
	});

	// Set the new current org
	await prisma.organisationUser.update({
		where: {
			organisationId_userId: {
				organisationId,
				userId: user!.id,
			},
		},
		data: {
			isCurrent: true,
		},
	});

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

	// Verify user is a member
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId: id,
				userId: user!.id,
			},
		},
	});

	throwIfError(!membership, "You are not a member of this organisation");

	const updateData: { name?: string } = {};
	if (data.name) {
		updateData.name = data.name;
	}

	if (Object.keys(updateData).length === 0) {
		throw new Error("Nothing to update");
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

	throwIfError(!organisation, "Organisation not found");
	throwIfError(
		organisation!.createdByUserId !== user!.id,
		"Only the creator can delete the organisation"
	);
	throwIfError(
		organisation!._count.members > 1,
		"Cannot delete organisation with other members"
	);

	// Delete the organisation (cascade will handle members)
	await prisma.organisation.delete({
		where: { id },
	});

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

	// Verify inviter is a member
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId: user!.id,
			},
		},
	});

	throwIfError(!membership, "You are not a member of this organisation");

	// Check if user already exists
	const existingUser = await prisma.user.findUnique({
		where: { email },
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
			throw new Error("User is already a member of this organisation");
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
				email,
			},
		},
	});

	if (existingInvite) {
		throw new Error("User has already been invited to this organisation");
	}

	// Create invitation
	await prisma.organisationInvitedUser.create({
		data: {
			organisationId,
			email,
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

	const invitations = await prisma.organisationInvitedUser.findMany({
		where: {
			email: user!.email,
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

	throwIfError(!invitation, "Invitation not found");
	throwIfError(
		invitation!.email !== user!.email,
		"This invitation is not for you"
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

	throwIfError(!invitation, "Invitation not found");
	throwIfError(
		invitation!.email !== user!.email,
		"This invitation is not for you"
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
	const invitations = await prisma.organisationInvitedUser.findMany({
		where: { email },
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

	// Verify current user is a member
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId,
				userId: user!.id,
			},
		},
	});

	throwIfError(!membership, "You are not a member of this organisation");

	const organisation = await prisma.organisation.findUnique({
		where: { id: organisationId },
	});

	// Only creator can remove others, or user can remove themselves
	if (userId !== user!.id && organisation!.createdByUserId !== user!.id) {
		throw new Error("Only the organisation creator can remove other members");
	}

	// Creator cannot remove themselves if there are other members
	if (userId === organisation!.createdByUserId) {
		const memberCount = await prisma.organisationUser.count({
			where: { organisationId },
		});
		if (memberCount > 1) {
			throw new Error(
				"Cannot leave organisation while other members exist. Transfer ownership or remove other members first."
			);
		}
	}

	await prisma.organisationUser.delete({
		where: {
			organisationId_userId: {
				organisationId,
				userId,
			},
		},
	});

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

	throwIfError(!membership, "You are not a member of this organisation");

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

	throwIfError(!organisation, "Organisation not found");

	// Only owner can update roles
	throwIfError(
		organisation!.createdByUserId !== user!.id,
		"Only the organisation owner can update member roles"
	);

	// Cannot change owner's role
	throwIfError(
		userId === organisation!.createdByUserId,
		"Cannot change the owner's role"
	);

	// Validate role
	throwIfError(
		!["member", "admin"].includes(role),
		"Invalid role. Must be 'member' or 'admin'"
	);

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

	throwIfError(!membership, "You are not a member of this organisation");

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

	throwIfError(!invitation, "Invitation not found");

	// Verify user is a member of the organisation
	const membership = await prisma.organisationUser.findUnique({
		where: {
			organisationId_userId: {
				organisationId: invitation!.organisationId,
				userId: user!.id,
			},
		},
	});

	throwIfError(!membership, "You are not a member of this organisation");

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

	throwIfError(!membership, "You are not a member of this organisation");

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

	// Check if user has any current database config
	const existingCurrentConfig = await prisma.databaseConfigUser.findFirst({
		where: {
			userId,
			isCurrent: true,
		},
	});

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
			// Set the first config as current if user doesn't have any current config
			const isFirstConfig = i === 0;
			const shouldBeCurrent = !existingCurrentConfig && isFirstConfig;

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
		}
	}
}
