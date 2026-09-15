const mockFindMany = jest.fn();
const mockUpsert = jest.fn();
const mockGetCurrentOrganisation = jest.fn();
const mockGetCurrentProjectForOrganisation = jest.fn();

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		projectEnvironment: {
			findMany: (...a: unknown[]) => mockFindMany(...a),
			upsert: (...a: unknown[]) => mockUpsert(...a),
		},
	},
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: (...a: unknown[]) => mockGetCurrentOrganisation(...a),
	getCurrentProjectForOrganisation: (...a: unknown[]) =>
		mockGetCurrentProjectForOrganisation(...a),
}));

import {
	createProjectEnvironment,
	listProjectEnvironments,
	normalizeProjectEnvironment,
} from "@/lib/project-environment";
import prisma from "@/lib/prisma";

describe("normalizeProjectEnvironment", () => {
	it("lowercases and trims valid environment names", () => {
		expect(normalizeProjectEnvironment("  Prod-1  ")).toBe("prod-1");
	});

	it("accepts dots and underscores", () => {
		expect(normalizeProjectEnvironment("prod.eu_west")).toBe("prod.eu_west");
	});

	it("rejects empty input", () => {
		expect(() => normalizeProjectEnvironment("")).toThrow(
			"Environment must use lowercase letters, numbers, dots, hyphens, or underscores"
		);
	});

	it("rejects names starting with a disallowed character", () => {
		expect(() => normalizeProjectEnvironment("-prod")).toThrow();
	});

	it("rejects names with disallowed characters", () => {
		expect(() => normalizeProjectEnvironment("prod env")).toThrow();
	});

	it("rejects names over 63 characters", () => {
		expect(() => normalizeProjectEnvironment("a".repeat(64))).toThrow();
	});

	it("accepts names up to 63 characters", () => {
		const name = "a".repeat(63);
		expect(normalizeProjectEnvironment(name)).toBe(name);
	});

	it("coerces non-string values via String()", () => {
		expect(normalizeProjectEnvironment(123)).toBe("123");
	});

	it("rejects nullish input", () => {
		expect(() => normalizeProjectEnvironment(undefined)).toThrow();
		expect(() => normalizeProjectEnvironment(null)).toThrow();
	});
});

describe("listProjectEnvironments", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("lists environments scoped to the current project, ordered by name", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindMany.mockResolvedValue([{ id: "e1", name: "prod" }]);

		const result = await listProjectEnvironments();

		expect(mockGetCurrentProjectForOrganisation).toHaveBeenCalledWith("org-1");
		expect(mockFindMany).toHaveBeenCalledWith({
			where: { projectId: "proj-1" },
			orderBy: { name: "asc" },
		});
		expect(result).toEqual([{ id: "e1", name: "prod" }]);
	});

	it("throws when there is no current organisation", async () => {
		mockGetCurrentOrganisation.mockResolvedValue(null);

		await expect(listProjectEnvironments()).rejects.toThrow(
			"Organisation is required"
		);
		expect(mockGetCurrentProjectForOrganisation).not.toHaveBeenCalled();
	});

	it("throws when the organisation has no project for the current context", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue(null);

		await expect(listProjectEnvironments()).rejects.toThrow(
			"Project is required"
		);
	});
});

describe("createProjectEnvironment", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
	});

	it("normalizes the name and upserts via prisma", async () => {
		mockUpsert.mockResolvedValue({ id: "e1", projectId: "proj-1", name: "prod" });

		const result = await createProjectEnvironment("  PROD  ");

		expect(mockUpsert).toHaveBeenCalledWith({
			where: { projectId_name: { projectId: "proj-1", name: "prod" } },
			create: { projectId: "proj-1", name: "prod" },
			update: {},
		});
		expect(result).toEqual({ id: "e1", projectId: "proj-1", name: "prod" });
	});

	it("throws for an invalid environment name before touching prisma", async () => {
		await expect(createProjectEnvironment("bad env!")).rejects.toThrow();
		expect(mockUpsert).not.toHaveBeenCalled();
	});

	it("falls back to a stub record when the delegate lacks upsert (legacy CE mock)", async () => {
		const original = (prisma as any).projectEnvironment.upsert;
		(prisma as any).projectEnvironment.upsert = undefined;

		const result = await createProjectEnvironment("staging");

		expect(result).toEqual({ id: "", projectId: "proj-1", name: "staging" });

		(prisma as any).projectEnvironment.upsert = original;
	});
});
