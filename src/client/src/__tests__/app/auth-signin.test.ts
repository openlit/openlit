/**
 * @jest-environment node
 */
const mockAccountFindFirst = jest.fn();
const mockAccountCreate = jest.fn();

jest.mock("@prisma/client", () => ({
	// auth.ts builds its client at import time, so read the mocks lazily.
	PrismaClient: jest.fn(() => ({
		account: {
			findFirst: (...args: unknown[]) => mockAccountFindFirst(...args),
			create: (...args: unknown[]) => mockAccountCreate(...args),
		},
	})),
}));
jest.mock("@next-auth/prisma-adapter", () => ({ PrismaAdapter: jest.fn(() => ({})) }));
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

const signIn = authOptions.callbacks!.signIn! as (args: any) => Promise<boolean | string>;
const admin = { id: "admin-id", email: "user@openlit.io", name: "User", image: "x" };

function attempt(provider: string, profile: Record<string, unknown>, user: Record<string, unknown> = {}) {
	return signIn({
		user: { id: "provider-sub", email: "user@openlit.io", ...user },
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
});
