jest.mock("next/server", () => ({
	NextResponse: {
		json: jest.fn((body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
			status: init?.status ?? 200,
			headers: { get: (key: string) => init?.headers?.[key] ?? null },
			json: async () => body,
		})),
	},
}));

jest.mock("@/lib/audit/route", () => ({
	withAudit: (handler: unknown) => handler,
}));

jest.mock("@/lib/rbac/current", () => ({
	withCurrentOrganisationPermission: jest.fn(
		(_permission: string, handler: unknown) => handler
	),
}));

jest.mock("@/lib/platform/pricing/export", () => ({
	getPricingExport: jest.fn(),
}));

import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getPricingExport } from "@/lib/platform/pricing/export";
import { GET } from "@/app/api/pricing/export/[dbConfigId]/route";

const mockedGetPricingExport = getPricingExport as jest.MockedFunction<
	typeof getPricingExport
>;

// Captured before any mock is reset: the wrapping happens once, at
// module-evaluation time (`export const GET = withAudit(
// withCurrentOrganisationPermission(...))`), not per-request. CE's version
// of these wrappers is a no-op pass-through; enterprise editions resolve
// them to real permission + audit checks around this same handler.
const permissionGateCall = (withCurrentOrganisationPermission as jest.Mock).mock
	.calls[0];

describe("GET /api/pricing/export/[dbConfigId]", () => {
	beforeEach(() => {
		mockedGetPricingExport.mockReset();
	});

	it("is gated behind the pricing:export permission key", () => {
		expect(permissionGateCall).toEqual(["pricing:export", expect.any(Function)]);
	});

	it("returns the shared pricing export data with a cache header on success", async () => {
		mockedGetPricingExport.mockResolvedValue({
			data: { chat: { "gpt-4": { promptPrice: 0.01, completionPrice: 0.02 } } },
		});

		const response = await GET({} as any, { params: { dbConfigId: "db-1" } });

		expect(getPricingExport).toHaveBeenCalledWith("db-1");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
		await expect(response.json()).resolves.toEqual({
			chat: { "gpt-4": { promptPrice: 0.01, completionPrice: 0.02 } },
		});
	});

	it("passes through the shared function's error status", async () => {
		mockedGetPricingExport.mockResolvedValue({
			error: "Database config not found",
			status: 404,
		});

		const response = await GET({} as any, { params: { dbConfigId: "missing" } });

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: "Database config not found",
		});
	});
});
