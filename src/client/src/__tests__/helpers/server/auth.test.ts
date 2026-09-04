jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));

jest.mock("@/lib/platform/api-keys", () => ({
	getAPIKeyInfo: jest.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";
import {
	MIDDLEWARE_DATABASE_CONFIG_HEADER,
	resolveDbConfigId,
	resolveRequestAuth,
} from "@/helpers/server/auth";

function makeRequest(headers: Record<string, string> = {}) {
	return {
		headers: {
			get: (name: string) =>
				headers[name.toLowerCase()] ?? headers[name] ?? null,
		},
	} as unknown as Request;
}

describe("resolveDbConfigId", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("prefers the x-database-config-id header", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, null]);
		await expect(
			resolveDbConfigId(
				makeRequest({ [MIDDLEWARE_DATABASE_CONFIG_HEADER]: "db-header" })
			)
		).resolves.toEqual([null, "db-header"]);
		expect(getCurrentUser).not.toHaveBeenCalled();
	});

	it("returns unauthorized when there is no header and no user", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		await expect(resolveDbConfigId(makeRequest())).resolves.toEqual([
			"Unauthorized",
			undefined,
		]);
	});

	it("returns null error with undefined id when user is present without header", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		await expect(resolveDbConfigId(makeRequest())).resolves.toEqual([
			null,
			undefined,
		]);
	});
});

describe("resolveRequestAuth", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("resolves API key auth from middleware header and Bearer creator", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{ createdByUserId: "creator-1", databaseConfigId: "db-header" },
		]);
		await expect(
			resolveRequestAuth(
				makeRequest({
					[MIDDLEWARE_DATABASE_CONFIG_HEADER]: "db-header",
					Authorization: "Bearer openlit-test",
				})
			)
		).resolves.toEqual([
			null,
			{
				databaseConfigId: "db-header",
				userId: "creator-1",
				via: "apiKey",
			},
		]);
		expect(getCurrentUser).not.toHaveBeenCalled();
	});

	it("falls back to session when no middleware database config header", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		await expect(resolveRequestAuth(makeRequest())).resolves.toEqual([
			null,
			{ databaseConfigId: undefined, userId: "u1", via: "session" },
		]);
	});
});
