const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockGetCurrentOrganisation = jest.fn();
const mockGetCurrentProjectForOrganisation = jest.fn();
const mockHasScannerAdapterFactory = jest.fn();
const mockGetScannerTypeDescriptor = jest.fn();
const mockCreateScannerAdapter = jest.fn();

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		connectorInstance: {
			findFirst: (...a: unknown[]) => mockFindFirst(...a),
			findMany: (...a: unknown[]) => mockFindMany(...a),
			create: (...a: unknown[]) => mockCreate(...a),
			update: (...a: unknown[]) => mockUpdate(...a),
			delete: (...a: unknown[]) => mockDelete(...a),
		},
	},
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: (...a: unknown[]) => mockGetCurrentOrganisation(...a),
	getCurrentProjectForOrganisation: (...a: unknown[]) =>
		mockGetCurrentProjectForOrganisation(...a),
}));

jest.mock("@/lib/project-environment", () => ({
	createProjectEnvironment: jest.fn().mockResolvedValue({ id: "env-1" }),
}));

jest.mock("next/headers", () => ({
	headers: jest.fn(async () => ({
		get: () => null,
	})),
}));

jest.mock("@/utils/crypto", () => ({
	encryptValue: (value: string) => `enc:v1:${value}`,
	decryptValue: (value: string) => String(value).replace(/^enc:v1:/, ""),
	isEncrypted: (value: string) => String(value).startsWith("enc:v1:"),
}));

jest.mock("@/lib/access/connector-entitlement", () => ({
	assertPremiumConnectorAllowed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/platform/connectors/scanner/bootstrap", () => ({
	ensureScannerAdaptersRegistered: jest.fn(),
}));

jest.mock("@/lib/platform/connectors/scanner/registry", () => ({
	hasScannerAdapterFactory: (...a: unknown[]) => mockHasScannerAdapterFactory(...a),
	getScannerTypeDescriptor: (...a: unknown[]) => mockGetScannerTypeDescriptor(...a),
	createScannerAdapter: (...a: unknown[]) => mockCreateScannerAdapter(...a),
	listScannerTypeDescriptors: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	invalidateSourceSecretCache: jest.fn(),
}));

import {
	createScannerConnector,
	deleteScannerConnector,
	healthCheckScannerConnector,
	isScannerConnectorId,
	listScannerConnectors,
	runScannerJob,
	updateScannerConnector,
} from "@/lib/platform/connectors/scanner/crud";

const row = (over: Record<string, unknown> = {}) => ({
	id: "scanner:abc",
	category: "scanner",
	type: "trustabl",
	name: "Prod scan",
	environment: "production",
	organisationId: "org-1",
	projectId: "proj-1",
	settings: '{"target":"https://github.com/acme/checkout-agent"}',
	secretRef: 'enc:v1:{"githubToken":"gho-secret"}',
	status: "active",
	metadata: '{"category":"scanner","jobs":[]}',
	createdAt: new Date(),
	updatedAt: new Date(),
	...over,
});

beforeEach(() => {
	jest.clearAllMocks();
	mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
	mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
	mockHasScannerAdapterFactory.mockReturnValue(true);
	mockGetScannerTypeDescriptor.mockReturnValue({ type: "trustabl" });
	mockFindFirst.mockResolvedValue(null);
});

describe("scanner connector CRUD", () => {
	it("identifies scanner connector ids", () => {
		expect(isScannerConnectorId("scanner:abc")).toBe(true);
		expect(isScannerConnectorId("memory:abc")).toBe(false);
	});

	it("creates a project-scoped scanner connector and encrypts credentials", async () => {
		mockCreate.mockResolvedValue(row());
		const created = await createScannerConnector({
			name: "Prod scan",
			type: "trustabl",
			environment: "production",
			settings: { target: "https://github.com/acme/checkout-agent" },
			credentials: { githubToken: "gho-secret" },
		});
		expect(mockCreate.mock.calls[0][0].data).toEqual(
			expect.objectContaining({
				category: "scanner",
				type: "trustabl",
				projectId: "proj-1",
				secretRef: 'enc:v1:{"githubToken":"gho-secret"}',
			})
		);
		expect(created).not.toHaveProperty("secretRef");
		expect(JSON.stringify(created)).not.toContain("gho-secret");
	});

	it("rejects a missing name", async () => {
		await expect(createScannerConnector({ type: "trustabl" })).rejects.toThrow(
			/name is required/i
		);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("rejects an unknown type", async () => {
		mockHasScannerAdapterFactory.mockReturnValue(false);
		await expect(
			createScannerConnector({
				name: "X",
				type: "unknown-scanner",
				settings: { target: "https://github.com/acme/checkout-agent" },
			})
		).rejects.toThrow(/unknown scanner connector/i);
	});

	it("rejects a duplicate name in the same environment", async () => {
		mockFindFirst.mockResolvedValue({ id: "scanner:existing" });
		await expect(
			createScannerConnector({
				name: "Prod scan",
				type: "trustabl",
				environment: "production",
				settings: { target: "https://github.com/acme/checkout-agent" },
			})
		).rejects.toThrow(/already exists/);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("rejects local filesystem targets", async () => {
		await expect(
			createScannerConnector({
				name: "Prod scan",
				type: "trustabl",
				settings: { target: "/etc/passwd" },
			})
		).rejects.toThrow(/github/i);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("updates settings without exposing the secret", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row());
		const updated = await updateScannerConnector("scanner:abc", {
			settings: { target: "https://github.com/acme/checkout-agent" },
		});
		expect(updated).not.toHaveProperty("secretRef");
		expect(updated.hasSecret).toBe(true);
	});

	it("deletes only a scanner connector in the current project", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockDelete.mockResolvedValue(row());
		await expect(deleteScannerConnector("abc")).resolves.toEqual({ ok: true });
		expect(mockFindFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: "scanner:abc",
					projectId: "proj-1",
					category: "scanner",
				}),
			})
		);
	});

	it("health-checks through the registered adapter", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateScannerAdapter.mockReturnValue({
			healthCheck: async () => ({ ok: true, latencyMs: 12 }),
		});
		await expect(healthCheckScannerConnector("scanner:abc")).resolves.toEqual({
			ok: true,
			latencyMs: 12,
		});
	});

	it("lists environment-scoped scanner connectors without secretRef", async () => {
		mockFindMany.mockResolvedValue([row()]);
		const listed = await listScannerConnectors();
		expect(mockFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					projectId: "proj-1",
					category: "scanner",
					environment: "production",
				},
			})
		);
		expect(listed[0]).not.toHaveProperty("secretRef");
	});

	it("refuses a second scan while one is running", async () => {
		mockCreateScannerAdapter.mockReturnValue({
			scan: async () => ({ id: "job:x", status: "succeeded" }),
		});
		mockFindFirst.mockResolvedValue(
			row({
				metadata: JSON.stringify({
					jobs: [{ id: "job:1", status: "running", target: "https://github.com/acme/x", startedAt: new Date().toISOString() }],
				}),
			})
		);
		await expect(runScannerJob("scanner:abc")).rejects.toThrow(/already running/);
	});
});
