/**
 * Role-gated access for the coding-agents views.
 *
 * Two access tiers:
 *   - "viewer"  → can read aggregated views (Overview, Sessions list,
 *                  Dashboard). Per-user breakdowns are k-anonymized
 *                  via COHORT_K_FLOOR.
 *   - "admin"   → can additionally read raw per-user / per-session
 *                  detail, file dispute claims, and configure
 *                  classification policy.
 *
 * v1 maps these onto the existing organisation roles:
 *   - owner   → admin
 *   - admin   → admin
 *   - member  → viewer
 *   - <none>  → unauthorized
 *
 * Returning a CodingAgentAuth value (rather than a boolean) keeps the
 * privacy posture explicit at every callsite — queries take it as a
 * required argument instead of relying on ambient permission checks.
 */

import { getCurrentUser } from "@/lib/session";
import { getCurrentOrganisation } from "@/lib/organisation";
import prisma from "@/lib/prisma";
import getMessage from "@/constants/messages";

export type CodingAgentRole = "viewer" | "admin";

export interface CodingAgentAuth {
	userId: string;
	organizationId: string;
	role: CodingAgentRole;
	/** Underlying organisation_users.role; useful for finer-grained UI gating. */
	rawRole: string;
}

export class CodingAgentUnauthorizedError extends Error {
	constructor(message?: string) {
		super(message || getMessage().UNAUTHORIZED_USER);
		this.name = "CodingAgentUnauthorizedError";
	}
}

/**
 * Resolve the current user's coding-agents role for the active org.
 * Throws CodingAgentUnauthorizedError if the user has no current org
 * or is not a member of it. Callers should let it bubble up; the
 * Next route handler converts it to a 401/403 response.
 */
export async function requireCodingAgentAuth(): Promise<CodingAgentAuth> {
	const user = await getCurrentUser();
	if (!user) {
		throw new CodingAgentUnauthorizedError();
	}

	const org = await getCurrentOrganisation();
	if (!org?.id) {
		throw new CodingAgentUnauthorizedError(
			getMessage().NO_ORGANISATION_SELECTED ||
				"No active organisation. Switch organisations to continue."
		);
	}

	const [membership, organisation] = await Promise.all([
		prisma.organisationUser.findUnique({
			where: {
				organisationId_userId: {
					organisationId: org.id,
					userId: user.id,
				},
			},
			select: { role: true },
		}),
		prisma.organisation.findUnique({
			where: { id: org.id },
			select: { createdByUserId: true },
		}),
	]);

	if (!membership) {
		throw new CodingAgentUnauthorizedError();
	}

	// Promote the org creator to admin even if their membership row
	// says `member`. Older deployments seeded the creator without an
	// explicit role; a one-line migration backfilled the column but
	// the seed itself didn't, so a fresh setup ended up locking the
	// owner out of admin-only views (incl. the cohort-floor bypass for
	// coding-agents). Re-deriving from createdByUserId here makes the
	// auth check resilient to data drift.
	const isCreator = organisation?.createdByUserId === user.id;
	const role: CodingAgentRole =
		isCreator ||
		membership.role === "owner" ||
		membership.role === "admin"
			? "admin"
			: "viewer";

	return {
		userId: user.id,
		organizationId: org.id,
		role,
		rawRole: isCreator && membership.role === "member" ? "owner" : membership.role,
	};
}
