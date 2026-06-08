jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		organisationUser: {
			findUnique: jest.fn(),
		},
		project: {
			findMany: jest.fn(),
		},
	},
}));
jest.mock("@/lib/session", () => ({
	getCurrentUser: jest.fn(),
}));
jest.mock("@/lib/organisation", () => ({
	createOrganisationProject: jest.fn(),
	getCurrentProjectForOrganisation: jest.fn(),
}));
jest.mock("@/utils/asaw", () => jest.fn());

import { GET, POST } from "@/app/api/organisation/[id]/projects/route";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import {
	createOrganisationProject,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import asaw from "@/utils/asaw";

const params = { params: { id: "org1" } };

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function jsonRequest(body: unknown) {
	return {
		json: jest.fn().mockResolvedValue(body),
	} as unknown as Request;
}

function invalidJsonRequest() {
	return {
		json: jest.fn().mockRejectedValue(new Error("Invalid JSON")),
	} as unknown as Request;
}

describe("organisation projects route", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "user1" });
		(prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue({
			id: "membership1",
		});
		(prisma.project.findMany as jest.Mock).mockResolvedValue([]);
		(asaw as jest.Mock).mockImplementation(async (promise) => [null, await promise]);
		(getCurrentProjectForOrganisation as jest.Mock).mockResolvedValue({
			id: "project1",
		});
	});

	it("requires organisation membership before listing projects", async () => {
		(prisma.organisationUser.findUnique as jest.Mock).mockResolvedValue(null);

		const response = await GET({} as Request, params);

		expect(response.status).toBe(404);
		expect(await response.json()).toBe("Organisation not found");
		expect(prisma.project.findMany).not.toHaveBeenCalled();
	});

	it("marks the selected project in the list", async () => {
		(prisma.project.findMany as jest.Mock).mockResolvedValue([
			{ id: "project1", name: "Default", isDefault: true },
			{ id: "project2", name: "Production", isDefault: false },
		]);

		const response = await GET({} as Request, params);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual([
			expect.objectContaining({ id: "project1", isCurrent: true }),
			expect.objectContaining({ id: "project2", isCurrent: false }),
		]);
	});

	it("returns a validation error for invalid JSON", async () => {
		const response = await POST(invalidJsonRequest(), params);

		expect(response.status).toBe(400);
		expect(await response.json()).toBe("Project name is required");
		expect(createOrganisationProject).not.toHaveBeenCalled();
	});

	it("returns a validation error for long project names", async () => {
		const response = await POST(jsonRequest({ name: "a".repeat(121) }), params);

		expect(response.status).toBe(400);
		expect(await response.json()).toBe("Project name must be 120 characters or less");
		expect(createOrganisationProject).not.toHaveBeenCalled();
	});

	it("trims and creates valid project names", async () => {
		(asaw as jest.Mock).mockResolvedValueOnce([
			null,
			{ id: "project2", name: "Production" },
		]);

		const response = await POST(jsonRequest({ name: " Production " }), params);

		expect(response.status).toBe(200);
		expect(createOrganisationProject).toHaveBeenCalledWith("org1", "Production");
	});
});
