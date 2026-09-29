jest.mock("next/server", () => ({
	NextResponse: {
		json: (body: unknown, init?: { status?: number }) => ({
			status: init?.status ?? 200,
			json: async () => body,
		}),
	},
}));

jest.mock("@/lib/platform/api-keys", () => ({
	getAPIKeyInfo: jest.fn(),
}));

import { GET } from "@/app/api/auth/verify-key/route";
import { getAPIKeyInfo } from "@/lib/platform/api-keys";

function makeRequest(headers: Record<string, string> = {}) {
	return {
		headers: {
			get: (name: string) => headers[name] || null,
		},
	} as any;
}

describe("GET /api/auth/verify-key", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns 401 without a Bearer token", async () => {
		const res = await GET(makeRequest());
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({ valid: false });
	});

	it("returns the key's organisation, project, and environment", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([
			null,
			{
				databaseConfigId: "db-1",
				organisationId: "org-1",
				projectId: "proj-1",
				environment: "staging",
			},
		]);

		const res = await GET(
			makeRequest({ Authorization: "Bearer openlit-test" })
		);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({
			valid: true,
			databaseConfigId: "db-1",
			organisationId: "org-1",
			projectId: "proj-1",
			environment: "staging",
		});
	});

	it("returns 401 for an unknown key", async () => {
		(getAPIKeyInfo as jest.Mock).mockResolvedValue([null, null]);
		const res = await GET(
			makeRequest({ Authorization: "Bearer missing" })
		);
		expect(res.status).toBe(401);
	});
});
