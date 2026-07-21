jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));

jest.mock("@/lib/db-config", () => ({
	getDBConfigByIdForUser: jest.fn(),
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: jest.fn(),
	getCurrentProjectForOrganisation: jest.fn(),
}));

jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		UNAUTHORIZED_USER: "Unauthorized",
		PROJECT_ACCESS_REQUIRED: "Project access required",
	})),
}));

import { getCurrentUser } from "@/lib/session";
import { getDBConfigByIdForUser } from "@/lib/db-config";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import {
	withPermission,
	withEntitledPermission,
	withDbConfigAccess,
} from "@/lib/rbac/route";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

describe("CE rbac route helpers", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("leaves permission wrappers as no-ops", async () => {
		const handler = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
		expect(withPermission("x", handler)).toBe(handler);
		expect(withEntitledPermission("f", "x", handler)).toBe(handler);
	});

	it("rejects unauthenticated db-config access", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const handler = jest.fn();
		const wrapped = withDbConfigAccess(handler);
		const response = await wrapped(new Request("http://localhost"), {});
		expect(response.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("allows authenticated requests without a database config id", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue({ id: "org1" });
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue({ id: "p1" });
		const handler = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
		const wrapped = withDbConfigAccess(handler);
		const response = await wrapped(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({}),
			}),
			{}
		);
		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalled();
	});

	it("requires a current project when organisation is present and no db config id", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue({ id: "org1" });
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue(null);
		const handler = jest.fn();
		const wrapped = withDbConfigAccess(handler);
		const response = await wrapped(
			new Request("http://localhost", {
				method: "POST",
				body: JSON.stringify({}),
			}),
			{}
		);
		expect(response.status).toBe(403);
		expect(handler).not.toHaveBeenCalled();
	});

	it("rejects inaccessible database config ids", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getDBConfigByIdForUser as jest.Mock).mockResolvedValue(null);
		const handler = jest.fn();
		const wrapped = withDbConfigAccess(handler);
		const response = await wrapped(
			new Request("http://localhost", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ databaseConfigId: "db1" }),
			}),
			{}
		);
		expect(response.status).toBe(403);
		expect(getDBConfigByIdForUser).toHaveBeenCalledWith({
			id: "db1",
			userId: "u1",
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it("allows accessible database config ids from headers", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getDBConfigByIdForUser as jest.Mock).mockResolvedValue({ id: "db1" });
		const handler = jest.fn().mockResolvedValue(new Response(null, { status: 201 }));
		const wrapped = withDbConfigAccess(handler);
		const response = await wrapped(
			new Request("http://localhost", {
				method: "GET",
				headers: {
					[OPENLIT_CONTEXT_HEADERS.databaseConfigId]: "db1",
				},
			}),
			{}
		);
		expect(response.status).toBe(201);
		expect(handler).toHaveBeenCalled();
	});
});
