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

beforeAll(() => {
	Object.defineProperty(global, "Response", {
		value: {
			json: (body: unknown, init?: ResponseInit) => ({
				status: init?.status ?? 200,
				json: jest.fn().mockResolvedValue(body),
			}),
		},
		configurable: true,
	});
});

function jsonRequest(
	body: unknown,
	headers: Record<string, string> = {}
): Request {
	return {
		clone: () => ({
			json: jest.fn().mockResolvedValue(body),
		}),
		headers: {
			get: (key: string) => headers[key] ?? null,
		},
	} as unknown as Request;
}

describe("CE rbac route wrappers", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("withPermission returns the handler unchanged", async () => {
		const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }));
		const wrapped = withPermission("dashboard.read", handler);

		expect(wrapped).toBe(handler);
		await wrapped({} as Request, {});
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("withEntitledPermission returns the handler unchanged", async () => {
		const handler = jest.fn().mockResolvedValue(Response.json({ ok: true }));
		const wrapped = withEntitledPermission(
			"feature.alerts",
			"alerts.read",
			handler
		);

		expect(wrapped).toBe(handler);
		await wrapped({} as Request, {});
		expect(handler).toHaveBeenCalledTimes(1);
	});
});

describe("withDbConfigAccess", () => {
	const handler = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		handler.mockReset();
		handler.mockResolvedValue(Response.json({ ok: true }));
	});

	it("returns 401 when there is no current user", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const wrapped = withDbConfigAccess(handler);

		const res = await wrapped(jsonRequest({}), {});

		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
		expect(handler).not.toHaveBeenCalled();
	});

	it("returns 403 when no db config id and org has no current project", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue({ id: "org1" });
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue(null);
		const wrapped = withDbConfigAccess(handler);

		const res = await wrapped(jsonRequest({}), {});

		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({
			error: "Project access required",
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it("calls handler when no db config id and no current organisation", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue(null);
		const wrapped = withDbConfigAccess(handler);

		await wrapped(jsonRequest({}), {});

		expect(handler).toHaveBeenCalledTimes(1);
		expect(getCurrentProjectForOrganisation).not.toHaveBeenCalled();
	});

	it("calls handler when no db config id and org has a current project", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue({ id: "org1" });
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue({
			id: "p1",
		});
		const wrapped = withDbConfigAccess(handler);

		await wrapped(jsonRequest({}), {});

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("returns 403 when db config is not accessible to the user", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getDBConfigByIdForUser as jest.Mock).mockResolvedValue(null);
		const wrapped = withDbConfigAccess(handler);

		const res = await wrapped(jsonRequest({ databaseConfigId: "db-1" }), {});

		expect(getDBConfigByIdForUser).toHaveBeenCalledWith({
			id: "db-1",
			userId: "u1",
		});
		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({
			error: "Project access required",
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it("calls handler when db config is accessible", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getDBConfigByIdForUser as jest.Mock).mockResolvedValue({ id: "db-1" });
		const wrapped = withDbConfigAccess(handler);

		await wrapped(jsonRequest({ databaseConfigId: "db-1" }), {});

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it.each([
		[{ dbConfigId: "from-dbConfigId" }, "from-dbConfigId"],
		[{ selectedConfig: "from-selected-string" }, "from-selected-string"],
		[
			{ selectedConfig: { databaseConfigId: "from-selected-databaseConfigId" } },
			"from-selected-databaseConfigId",
		],
		[
			{ selectedConfig: { dbConfigId: "from-selected-dbConfigId" } },
			"from-selected-dbConfigId",
		],
	])("extracts database config id from body %#", async (body, expectedId) => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getDBConfigByIdForUser as jest.Mock).mockResolvedValue({ id: expectedId });
		const wrapped = withDbConfigAccess(handler);

		await wrapped(jsonRequest(body), {});

		expect(getDBConfigByIdForUser).toHaveBeenCalledWith({
			id: expectedId,
			userId: "u1",
		});
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("extracts database config id from request header", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getDBConfigByIdForUser as jest.Mock).mockResolvedValue({ id: "hdr-db" });
		const wrapped = withDbConfigAccess(handler);

		await wrapped(
			jsonRequest(
				{},
				{ [OPENLIT_CONTEXT_HEADERS.databaseConfigId]: "hdr-db" }
			),
			{}
		);

		expect(getDBConfigByIdForUser).toHaveBeenCalledWith({
			id: "hdr-db",
			userId: "u1",
		});
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("treats invalid JSON body as empty and continues without db config id", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue(null);
		const request = {
			clone: () => ({
				json: jest.fn().mockRejectedValue(new Error("bad json")),
			}),
			headers: { get: () => null },
		} as unknown as Request;
		const wrapped = withDbConfigAccess(handler);

		await wrapped(request, {});

		expect(handler).toHaveBeenCalledTimes(1);
		expect(getDBConfigByIdForUser).not.toHaveBeenCalled();
	});

	it("uses empty body when request has no clone", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue(null);
		const request = {
			headers: { get: () => null },
		} as unknown as Request;
		const wrapped = withDbConfigAccess(handler);

		await wrapped(request, {});

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("ignores blank string database config ids", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1" });
		(getCurrentOrganisation as jest.Mock).mockResolvedValue(null);
		const wrapped = withDbConfigAccess(handler);

		await wrapped(jsonRequest({ databaseConfigId: "   " }), {});

		expect(getDBConfigByIdForUser).not.toHaveBeenCalled();
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
