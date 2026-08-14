import prisma from "@/lib/prisma";
import {
	CodingAgentUnauthorizedError,
	requireCodingAgentAuth,
} from "@/lib/platform/coding-agents/auth";
import { getCurrentOrganisation } from "@/lib/organisation";
import { getCurrentUser } from "@/lib/session";

jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: () => ({
		UNAUTHORIZED_USER: "Unauthorized user!",
		NO_ORGANISATION_SELECTED: "No active organisation.",
	}),
}));

jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		organisationUser: {
			findUnique: jest.fn(),
		},
		organisation: {
			findUnique: jest.fn(),
		},
	},
}));

const mockGetCurrentUser = jest.mocked(getCurrentUser);
const mockGetCurrentOrganisation = jest.mocked(getCurrentOrganisation);
const mockFindMembership = jest.mocked(prisma.organisationUser.findUnique);
const mockFindOrganisation = jest.mocked(prisma.organisation.findUnique);

describe("requireCodingAgentAuth", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockGetCurrentUser.mockResolvedValue({ id: "user-1" } as any);
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" } as any);
		mockFindMembership.mockResolvedValue({ role: "member" } as any);
		mockFindOrganisation.mockResolvedValue({ createdByUserId: "user-2" } as any);
	});

	it("rejects missing user", async () => {
		mockGetCurrentUser.mockResolvedValue(null as any);

		await expect(requireCodingAgentAuth()).rejects.toThrow(
			new CodingAgentUnauthorizedError("Unauthorized user!")
		);
		expect(mockFindMembership).not.toHaveBeenCalled();
	});

	it("rejects missing organisation", async () => {
		mockGetCurrentOrganisation.mockResolvedValue(null as any);

		await expect(requireCodingAgentAuth()).rejects.toThrow(
			new CodingAgentUnauthorizedError("No active organisation.")
		);
		expect(mockFindMembership).not.toHaveBeenCalled();
	});

	it("rejects users without organisation membership", async () => {
		mockFindMembership.mockResolvedValue(null);

		await expect(requireCodingAgentAuth()).rejects.toThrow(
			CodingAgentUnauthorizedError
		);
	});

	it("returns viewer auth for organisation members", async () => {
		await expect(requireCodingAgentAuth()).resolves.toEqual({
			userId: "user-1",
			organizationId: "org-1",
			role: "viewer",
			rawRole: "member",
		});

		expect(mockFindMembership).toHaveBeenCalledWith({
			where: {
				organisationId_userId: {
					organisationId: "org-1",
					userId: "user-1",
				},
			},
			select: { role: true },
		});
	});

	it.each(["admin", "owner"])("returns admin auth for %s members", async (role) => {
		mockFindMembership.mockResolvedValue({ role } as any);

		await expect(requireCodingAgentAuth()).resolves.toMatchObject({
			role: "admin",
			rawRole: role,
		});
	});

	it("promotes the organisation creator to owner/admin", async () => {
		mockFindOrganisation.mockResolvedValue({ createdByUserId: "user-1" } as any);

		await expect(requireCodingAgentAuth()).resolves.toMatchObject({
			role: "admin",
			rawRole: "owner",
		});
	});
});
