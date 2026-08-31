const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockGetCurrentOrganisation = jest.fn();
const mockGetCurrentProjectForOrganisation = jest.fn();
const mockHasMemoryAdapterFactory = jest.fn();
const mockGetMemoryTypeDescriptor = jest.fn();
const mockCreateMemoryAdapter = jest.fn();

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

jest.mock("@/lib/platform/connectors/memory/bootstrap", () => ({
	ensureMemoryAdaptersRegistered: jest.fn(),
}));

jest.mock("@/lib/platform/connectors/memory/registry", () => ({
	hasMemoryAdapterFactory: (...a: unknown[]) => mockHasMemoryAdapterFactory(...a),
	getMemoryTypeDescriptor: (...a: unknown[]) => mockGetMemoryTypeDescriptor(...a),
	createMemoryAdapter: (...a: unknown[]) => mockCreateMemoryAdapter(...a),
	listMemoryTypeDescriptors: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	invalidateSourceSecretCache: jest.fn(),
}));

import {
	createMemoryConnector,
	deleteMemoryConnector,
	healthCheckMemoryConnector,
	isMemoryConnectorId,
	listMemoryConnectors,
	readRememberedMemoryFilters,
	rememberMemoryFilters,
	updateMemoryConnector,
} from "@/lib/platform/connectors/memory/crud";

const row = (over: Record<string, unknown> = {}) => ({
	id: "memory:abc",
	category: "memory",
	type: "mem0",
	name: "Prod Mem0",
	environment: "production",
	organisationId: "org-1",
	projectId: "proj-1",
	settings: '{"url":"https://api.mem0.ai"}',
	secretRef: 'enc:v1:{"apiKey":"m0-key"}',
	status: "active",
	metadata: "{}",
	createdAt: new Date(),
	updatedAt: new Date(),
	...over,
});

beforeEach(() => {
	jest.clearAllMocks();
	mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
	mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
	mockHasMemoryAdapterFactory.mockReturnValue(true);
	mockGetMemoryTypeDescriptor.mockReturnValue({ type: "mem0" });
	mockFindFirst.mockResolvedValue(null);
});

describe("memory connector CRUD", () => {
	it("identifies memory connector ids", () => {
		expect(isMemoryConnectorId("memory:abc")).toBe(true);
		expect(isMemoryConnectorId("telemetry:abc")).toBe(false);
	});

	it("creates a project-scoped memory connector and encrypts credentials without ClickHouse vault", async () => {
		mockCreate.mockResolvedValue(row({ secretRef: 'enc:v1:{"apiKey":"m0-key"}' }));
		const created = await createMemoryConnector({
			name: "Prod Mem0",
			type: "mem0",
			environment: "production",
			settings: { url: "https://api.mem0.ai" },
			credentials: { apiKey: "m0-key" },
		});
		expect(mockCreate.mock.calls[0][0].data).toEqual(
			expect.objectContaining({
				category: "memory",
				type: "mem0",
				projectId: "proj-1",
				secretRef: 'enc:v1:{"apiKey":"m0-key"}',
			})
		);
		expect(created).toEqual(
			expect.objectContaining({
				id: "memory:abc",
				hasSecret: true,
				category: "memory",
			})
		);
		expect(created).not.toHaveProperty("secretRef");
		expect(JSON.stringify(created)).not.toContain("m0-key");
	});

	it("rejects a ClickHouse vault id instead of an inline encrypted key", async () => {
		await expect(
			createMemoryConnector({
				name: "Prod Mem0",
				type: "mem0",
				environment: "production",
				secretRef: "vault-1",
			})
		).rejects.toThrow(/store its API key on the connector/i);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("rejects a missing name", async () => {
		await expect(createMemoryConnector({ type: "mem0" })).rejects.toThrow(
			/name is required/i
		);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("rejects an unknown type", async () => {
		mockHasMemoryAdapterFactory.mockReturnValue(false);
		await expect(
			createMemoryConnector({ name: "X", type: "unknown-memory" })
		).rejects.toThrow(/unknown memory connector/i);
	});

	it("rejects a duplicate name in the same environment", async () => {
		mockFindFirst.mockResolvedValue({ id: "memory:existing" });
		await expect(
			createMemoryConnector({
				name: "Prod Mem0",
				type: "mem0",
				environment: "production",
			})
		).rejects.toThrow(/already exists/);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("updates settings without exposing the secret", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row());
		const updated = await updateMemoryConnector("memory:abc", {
			settings: { url: "https://api.mem0.ai" },
		});
		expect(mockUpdate).toHaveBeenCalled();
		expect(updated).not.toHaveProperty("secretRef");
		expect(updated.hasSecret).toBe(true);
	});

	it("deletes only a memory connector in the current project", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockDelete.mockResolvedValue(row());
		await expect(deleteMemoryConnector("abc")).resolves.toEqual({ ok: true });
		expect(mockFindFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: "memory:abc",
					projectId: "proj-1",
					category: "memory",
				}),
			})
		);
	});

	it("health-checks through the registered adapter", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateMemoryAdapter.mockReturnValue({
			healthCheck: async () => ({ ok: true, latencyMs: 12 }),
		});
		await expect(healthCheckMemoryConnector("memory:abc")).resolves.toEqual({
			ok: true,
			latencyMs: 12,
		});
	});

	it("lists environment-scoped memory connectors without secretRef", async () => {
		mockFindMany.mockResolvedValue([row()]);
		const listed = await listMemoryConnectors();
		expect(mockFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					projectId: "proj-1",
					category: "memory",
					environment: "production",
				},
			})
		);
		expect(listed[0]).not.toHaveProperty("secretRef");
		expect(listed[0].hasSecret).toBe(true);
	});

	it("lists connectors for an explicit environment", async () => {
		mockFindMany.mockResolvedValue([
			row({ id: "memory:dev", name: "Dev Mem0", environment: "development" }),
		]);
		await listMemoryConnectors("development");
		expect(mockFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					projectId: "proj-1",
					category: "memory",
					environment: "development",
				},
			})
		);
	});

	it("remembers typed user ids and omits them from public connector metadata", async () => {
		mockFindFirst.mockResolvedValue(
			row({
				metadata: JSON.stringify({
					category: "memory",
					memoryFilters: { users: ["ada"] },
				}),
			})
		);
		mockUpdate.mockResolvedValue(row());
		await rememberMemoryFilters("abc", { users: ["aman"] });
		expect(JSON.parse(mockUpdate.mock.calls[0][0].data.metadata)).toEqual({
			category: "memory",
			memoryFilters: { users: ["ada", "aman"], sessions: [], agents: [] },
		});

		await expect(readRememberedMemoryFilters("abc")).resolves.toEqual({
			users: ["ada"],
			sessions: [],
			agents: [],
		});

		mockFindMany.mockResolvedValue([
			row({
				metadata: JSON.stringify({
					category: "memory",
					memoryFilters: { users: ["aman"] },
				}),
			}),
		]);
		const listed = await listMemoryConnectors();
		expect(JSON.parse(String(listed[0].metadata))).toEqual({ category: "memory" });
	});

	it("omits memory connectors whose adapter is no longer registered", async () => {
		mockFindMany.mockResolvedValue([
			row(),
			row({ id: "memory:gone", type: "unknown-vendor", name: "retired vendor" }),
		]);
		mockHasMemoryAdapterFactory.mockImplementation((type: unknown) => type === "mem0");
		const listed = await listMemoryConnectors();
		expect(listed.map((item) => item.id)).toEqual(["memory:abc"]);
	});
});
