/**
 * @jest-environment node
 */
const mockAccountFindFirst = jest.fn();
const mockAccountCreate = jest.fn();
const mockBaseCreateUser = jest.fn();

jest.mock("@prisma/client", () => ({
	// auth.ts builds its client at import time, so read the mocks lazily.
	PrismaClient: jest.fn(() => ({
		account: {
			findFirst: (...args: unknown[]) => mockAccountFindFirst(...args),
			create: (...args: unknown[]) => mockAccountCreate(...args),
		},
	})),
}));
jest.mock("@next-auth/prisma-adapter", () => ({
	PrismaAdapter: jest.fn(() => ({ createUser: (...args: unknown[]) => mockBaseCreateUser(...args) })),
}));
jest.mock("@/lib/db-config", () => ({ moveSharedDBConfigToDBUser: jest.fn() }));
jest.mock("@/lib/organisation", () => ({ moveInvitationsToMembership: jest.fn() }));
jest.mock("@/lib/user", () => ({
	createNewUser: jest.fn(),
	getUserByEmail: jest.fn(),
	updateUser: jest.fn(),
	doesPasswordMatches: jest.fn(),
	getUserById: jest.fn(),
}));
jest.mock("@/lib/instance-admin", () => ({ isInstanceAdminUser: jest.fn() }));

import { authOptions } from "@/app/auth";
import { getUserByEmail } from "@/lib/user";
import { moveSharedDBConfigToDBUser } from "@/lib/db-config";
import { moveInvitationsToMembership } from "@/lib/organisation";

const signIn = authOptions.callbacks!.signIn! as (args: any) => Promise<boolean | string>;
const admin = { id: "admin-id", email: "user@openlit.io", name: "User", image: "x" };

function attempt(provider: string, profile: Record<string, unknown>, user: Record<string, unknown> = {}) {
	return signIn({
		user: Object.assign(user, { id: "provider-sub", email: "user@openlit.io", ...user }),
		account: { provider, providerAccountId: "provider-sub", type: "oauth" },
		profile,
	});
}

describe("OAuth sign-in account linking", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getUserByEmail as jest.Mock).mockResolvedValue(admin);
		mockAccountFindFirst.mockResolvedValue(null);
	});

	it("refuses to link an unverified Microsoft email to an existing account", async () => {
		await expect(
			attempt("azure-ad", { email: "user@openlit.io" }, { emailTrusted: false })
		).resolves.toBe("/login?error=OAuthAccountNotLinked");
		expect(mockAccountCreate).not.toHaveBeenCalled();
	});

	it("refuses Google and Okta emails the provider has not verified", async () => {
		await expect(attempt("google", { email_verified: false })).resolves.toBe("/login?error=AccessDenied");
		await expect(attempt("okta", {})).resolves.toBe("/login?error=OAuthAccountNotLinked");
		expect(mockAccountCreate).not.toHaveBeenCalled();
	});

	it("links a verified email to the existing account", async () => {
		await expect(attempt("google", { email_verified: true })).resolves.toBe(true);
		expect(mockAccountCreate).toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ userId: "admin-id", provider: "google" }) })
		);
	});

	it("lets an identity already linked to the account sign in", async () => {
		mockAccountFindFirst.mockImplementation(async ({ where }: any) =>
			where.providerAccountId ? { userId: "admin-id" } : { id: "existing-link" }
		);
		await expect(
			attempt("azure-ad", { email: "user@openlit.io" }, { emailTrusted: false })
		).resolves.toBe(true);
	});

	it("still allows new accounts when no account uses the email", async () => {
		(getUserByEmail as jest.Mock).mockRejectedValue(new Error("Invalid email or password"));
		await expect(attempt("okta", {})).resolves.toBe(true);
		expect(mockAccountCreate).not.toHaveBeenCalled();
	});

	it("refuses an identity that is linked to a different account", async () => {
		mockAccountFindFirst.mockResolvedValue({ userId: "someone-else" });
		await expect(attempt("google", { email_verified: true })).resolves.toBe("/login?error=OAuthAccountNotLinked");
		expect(mockAccountCreate).not.toHaveBeenCalled();
	});

	it("marks whether the provider vouched for a new account's email", async () => {
		(getUserByEmail as jest.Mock).mockRejectedValue(new Error("Invalid email or password"));
		const microsoft: Record<string, unknown> = { emailTrusted: false };
		await attempt("azure-ad", { email: "invitee@example.com" }, microsoft);
		expect(microsoft.emailVouched).toBe(false);

		const google: Record<string, unknown> = {};
		await attempt("google", { email_verified: true }, google);
		expect(google.emailVouched).toBe(true);
	});
});

describe("OAuth account creation", () => {
	const createUser = authOptions.adapter!.createUser! as (user: any) => Promise<any>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockBaseCreateUser.mockImplementation(async (data: any) => ({ id: "new-user", ...data }));
	});

	it("stores only user columns from the provider profile", async () => {
		await createUser({
			name: "Ada",
			email: " Ada@Example.com ",
			image: null,
			emailVerified: null,
			emailTrusted: false,
			emailVouched: false,
			tid: "tenant",
		});
		expect(mockBaseCreateUser).toHaveBeenCalledWith({
			name: "Ada",
			email: "ada@example.com",
			image: null,
			emailVerified: null,
		});
	});

	it("only claims invitations and shared configs for a vouched email", async () => {
		await createUser({ name: "Attacker", email: "invitee@example.com", emailVouched: false });
		expect(moveInvitationsToMembership).not.toHaveBeenCalled();
		expect(moveSharedDBConfigToDBUser).not.toHaveBeenCalled();

		await createUser({ name: "Invitee", email: "invitee@example.com", emailVouched: true });
		expect(moveInvitationsToMembership).toHaveBeenCalledWith("invitee@example.com", "new-user");
		expect(moveSharedDBConfigToDBUser).toHaveBeenCalledWith("invitee@example.com", "new-user");
	});
});
