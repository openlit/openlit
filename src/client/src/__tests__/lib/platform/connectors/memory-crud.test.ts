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

import { headers } from "next/headers";
import { listMemoryTypeDescriptors } from "@/lib/platform/connectors/memory/registry";
import {
	availableMemoryTypeDescriptors,
	createMemoryConnector,
	deleteMemoryConnector,
	emptyRememberedMemoryFilters,
	getMemoryRuntime,
	healthCheckMemoryConnector,
	isMemoryConnectorId,
	isMemoryConnectorType,
	listMemoryConnectors,
	memoryConnectorId,
	readMemoryPortLinks,
	readRememberedMemoryFilters,
	recordMemoryPortLinks,
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

	it("prefixes a bare id and leaves an already-prefixed id untouched", () => {
		expect(memoryConnectorId("abc")).toBe("memory:abc");
		expect(memoryConnectorId("memory:abc")).toBe("memory:abc");
		expect(memoryConnectorId("")).toBe("memory:");
	});

	it("denies when there is no current organisation at all", async () => {
		mockGetCurrentOrganisation.mockResolvedValue(null);
		await expect(
			createMemoryConnector({ name: "X", type: "mem0" })
		).rejects.toThrow(/no current project/i);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("denies when the user has no current project for the organisation", async () => {
		mockGetCurrentProjectForOrganisation.mockResolvedValue(null);
		await expect(
			createMemoryConnector({ name: "X", type: "mem0" })
		).rejects.toThrow(/no current project/i);
		expect(mockCreate).not.toHaveBeenCalled();
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

	it("rejects a blank type", async () => {
		await expect(
			createMemoryConnector({ name: "X", type: "" })
		).rejects.toThrow(/unknown memory connector/i);
		expect(mockCreate).not.toHaveBeenCalled();
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

	it("rejects an environment name with invalid characters", async () => {
		await expect(
			createMemoryConnector({
				name: "Prod Mem0",
				type: "mem0",
				environment: "Prod!!",
			})
		).rejects.toThrow(/letters, numbers, dots, hyphens, or underscores/i);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("resolves the environment from the request header when none is given explicitly", async () => {
		(headers as jest.Mock).mockResolvedValueOnce({
			get: (key: string) =>
				key === "x-openlit-environment" ? "staging" : null,
		});
		mockFindMany.mockResolvedValue([row({ environment: "staging" })]);
		await listMemoryConnectors();
		expect(mockFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ environment: "staging" }),
			})
		);
	});

	it("falls back to production when reading headers throws outside a request", async () => {
		(headers as jest.Mock).mockRejectedValueOnce(new Error("no request context"));
		mockFindMany.mockResolvedValue([row()]);
		await listMemoryConnectors();
		expect(mockFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ environment: "production" }),
			})
		);
	});

	it("rejects settings that are not valid JSON", async () => {
		await expect(
			createMemoryConnector({
				name: "Prod Mem0",
				type: "mem0",
				settings: "{not json",
			})
		).rejects.toThrow(/must be a json object/i);
	});

	it("rejects settings that parse to a non-object", async () => {
		await expect(
			createMemoryConnector({
				name: "Prod Mem0",
				type: "mem0",
				settings: "[1,2,3]",
			})
		).rejects.toThrow(/must be a json object/i);
		await expect(
			createMemoryConnector({
				name: "Prod Mem0",
				type: "mem0",
				settings: 42,
			})
		).rejects.toThrow(/must be a json object/i);
	});

	it("accepts settings passed as a JSON string and normalizes the endpoint url", async () => {
		mockCreate.mockResolvedValue(row());
		await createMemoryConnector({
			name: "Prod Mem0",
			type: "mem0",
			settings: '{"url":"https://api.mem0.ai/"}',
		});
		expect(JSON.parse(mockCreate.mock.calls[0][0].data.settings)).toEqual(
			expect.objectContaining({ url: "https://api.mem0.ai" })
		);
	});

	it("checks whether a type is a known memory connector type", () => {
		expect(isMemoryConnectorType("mem0")).toBe(true);
		mockHasMemoryAdapterFactory.mockReturnValueOnce(false);
		expect(isMemoryConnectorType("unknown")).toBe(false);
	});

	it("treats a blank/missing type as not a known memory connector type", () => {
		mockHasMemoryAdapterFactory.mockImplementation((type: unknown) => !!type);
		expect(isMemoryConnectorType("")).toBe(false);
		expect(isMemoryConnectorType(undefined)).toBe(false);
	});

	it("lists available memory type descriptors with category and scope metadata", () => {
		(listMemoryTypeDescriptors as jest.Mock).mockReturnValue([
			{ type: "mem0", displayName: "Mem0", description: "", icon: "" },
		]);
		const descriptors = availableMemoryTypeDescriptors();
		expect(descriptors).toEqual([
			expect.objectContaining({
				type: "mem0",
				category: "memory",
				scope: "project",
				declaredSignals: [],
			}),
		]);
	});

	it("keeps a descriptor's own description and icon instead of the generated defaults", () => {
		(listMemoryTypeDescriptors as jest.Mock).mockReturnValue([
			{
				type: "mem0",
				displayName: "Mem0",
				description: "Already described",
				icon: "/already.svg",
			},
		]);
		const descriptors = availableMemoryTypeDescriptors();
		expect(descriptors[0]).toMatchObject({
			description: "Already described",
			icon: "/already.svg",
		});
	});

	it("reads and records port links on a memory connector", async () => {
		mockFindFirst.mockResolvedValue(
			row({
				metadata: JSON.stringify({
					category: "memory",
					memoryPorts: [
						{
							sourceConnectorId: "memory:src",
							sourceMemoryId: "m1",
							copiedAt: "2026-08-18T00:00:00.000Z",
							contentFingerprint: "fp1",
						},
						{ sourceConnectorId: "", sourceMemoryId: "" },
						"not-an-object",
					],
				}),
			})
		);
		await expect(readMemoryPortLinks("abc")).resolves.toEqual([
			expect.objectContaining({ sourceConnectorId: "memory:src", sourceMemoryId: "m1" }),
		]);

		// A required-fields-only entry: optional fields fall back to "" or
		// undefined instead of throwing.
		mockFindFirst.mockResolvedValue(
			row({
				metadata: JSON.stringify({
					memoryPorts: [
						{ sourceConnectorId: "memory:src", sourceMemoryId: "m2" },
					],
				}),
			})
		);
		await expect(readMemoryPortLinks("abc")).resolves.toEqual([
			expect.objectContaining({
				sourceConnectorId: "memory:src",
				sourceMemoryId: "m2",
				sourceConnectorType: undefined,
				sourceConnectorName: undefined,
				originConnectorId: undefined,
				originMemoryId: undefined,
				destMemoryId: undefined,
				copiedAt: "",
				contentFingerprint: "",
			}),
		]);

		mockUpdate.mockResolvedValue(row());
		await recordMemoryPortLinks("abc", [
			{
				sourceConnectorId: "memory:src2",
				sourceMemoryId: "m2",
				copiedAt: "2026-08-19T00:00:00.000Z",
				contentFingerprint: "fp2",
			},
		]);
		const stored = JSON.parse(mockUpdate.mock.calls[0][0].data.metadata).memoryPorts;
		expect(stored).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ sourceConnectorId: "memory:src2", sourceMemoryId: "m2" }),
			])
		);
	});

	it("does nothing when recording an empty list of port links", async () => {
		await recordMemoryPortLinks("abc", []);
		expect(mockFindFirst).not.toHaveBeenCalled();
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("throws when recording port links on a missing connector", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(
			recordMemoryPortLinks("missing", [
				{
					sourceConnectorId: "memory:src",
					sourceMemoryId: "m1",
					copiedAt: "2026-08-18T00:00:00.000Z",
					contentFingerprint: "fp1",
				},
			])
		).rejects.toThrow(/not found/i);
	});

	it("does not persist remembered filters that are already known", async () => {
		mockFindFirst.mockResolvedValue(
			row({
				metadata: JSON.stringify({
					category: "memory",
					memoryFilters: { users: ["ada"], sessions: [], agents: [] },
				}),
			})
		);
		await rememberMemoryFilters("abc", { users: ["ada"] });
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("does nothing when remembering an empty filter patch", async () => {
		await rememberMemoryFilters("abc", {});
		expect(mockFindFirst).not.toHaveBeenCalled();
	});

	it("throws when remembering filters on a missing connector", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(rememberMemoryFilters("missing", { users: ["ada"] })).rejects.toThrow(
			/not found/i
		);
	});

	it("updates the connector environment and detects a name/environment clash", async () => {
		mockFindFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
			if (args.where && "NOT" in args.where) return { id: "memory:other" };
			return row();
		});
		await expect(
			updateMemoryConnector("abc", {
				name: "New Name",
				environment: "development",
			})
		).rejects.toThrow(/already exists/i);
	});

	it("updates credentials and invalidates the previous secret cache", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row());
		const updated = await updateMemoryConnector("abc", {
			credentials: { apiKey: "new-key" },
		});
		expect(mockUpdate.mock.calls[0][0].data.secretRef).toContain("new-key");
		expect(updated.hasSecret).toBe(true);
	});

	it("rejects updating with an inline unencrypted secretRef", async () => {
		mockFindFirst.mockResolvedValue(row());
		await expect(
			updateMemoryConnector("abc", { secretRef: "plain-vault-id" })
		).rejects.toThrow(/store its API key on the connector/i);
	});

	it("rejects updating a connector that no longer exists", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(
			updateMemoryConnector("missing", { name: "New Name" })
		).rejects.toThrow(/not found/i);
	});

	it("rejects clearing the connector name on update", async () => {
		mockFindFirst.mockResolvedValue(row());
		await expect(updateMemoryConnector("abc", { name: "   " })).rejects.toThrow(
			/name is required/i
		);
	});

	it("rejects an explicitly blank (but defined) connector name on update", async () => {
		mockFindFirst.mockResolvedValue(row());
		await expect(updateMemoryConnector("abc", { name: "" })).rejects.toThrow(
			/name is required/i
		);
	});

	it("validates a null secretRef when neither credentials nor secretRef change", async () => {
		mockFindFirst.mockResolvedValue(row({ secretRef: null }));
		mockUpdate.mockResolvedValue(row({ secretRef: null }));
		const updated = await updateMemoryConnector("abc", { settings: { url: "https://x" } });
		expect(updated.hasSecret).toBe(false);
	});

	it("invalidates the secret cache with undefined when the prior secretRef was empty", async () => {
		mockFindFirst.mockResolvedValue(row({ secretRef: null }));
		mockUpdate.mockResolvedValue(row({ secretRef: 'enc:v1:{"apiKey":"new-key"}' }));
		const updated = await updateMemoryConnector("abc", {
			credentials: { apiKey: "new-key" },
		});
		expect(updated.hasSecret).toBe(true);
	});

	it("gets the runtime for a specific connector id", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateMemoryAdapter.mockReturnValue({ healthCheck: async () => ({ ok: true }) });
		const runtime = await getMemoryRuntime("abc");
		expect(runtime.connector.id).toBe("memory:abc");
		expect(runtime.adapter).toBeDefined();
	});

	it("gets the runtime for the first connector when no id is given", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateMemoryAdapter.mockReturnValue({ healthCheck: async () => ({ ok: true }) });
		await getMemoryRuntime();
		expect(mockFindFirst).toHaveBeenCalledWith(
			expect.objectContaining({ orderBy: [{ createdAt: "asc" }] })
		);
	});

	it("throws when no memory connector exists for the runtime lookup", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(getMemoryRuntime("missing")).rejects.toThrow(/not found/i);
	});

	it("throws when the runtime adapter type is no longer registered", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateMemoryAdapter.mockReturnValue(undefined);
		await expect(getMemoryRuntime("abc")).rejects.toThrow(/unknown memory connector/i);
	});

	it("throws healthCheckMemoryConnector when the adapter type is no longer registered", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateMemoryAdapter.mockReturnValue(undefined);
		await expect(healthCheckMemoryConnector("abc")).rejects.toThrow(
			/unknown memory connector/i
		);
	});

	it("returns an empty remembered-filters shape by default", () => {
		expect(emptyRememberedMemoryFilters()).toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("dedupes remembered filter ids given as objects with an id field", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row());
		await rememberMemoryFilters("abc", {
			users: [{ id: "ada" } as unknown as string, { id: "ada" } as unknown as string, { id: "" } as unknown as string],
		});
		expect(JSON.parse(mockUpdate.mock.calls[0][0].data.metadata).memoryFilters).toEqual({
			users: ["ada"],
			sessions: [],
			agents: [],
		});
	});

	it("ignores filter entries that are neither strings nor plain id objects", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row());
		await rememberMemoryFilters("abc", {
			users: [
				42 as unknown as string,
				null as unknown as string,
				["nested"] as unknown as string,
				"ada",
			],
		});
		expect(JSON.parse(mockUpdate.mock.calls[0][0].data.metadata).memoryFilters).toEqual({
			users: ["ada"],
			sessions: [],
			agents: [],
		});
	});

	it("treats non-object remembered filter metadata as empty", async () => {
		mockFindFirst.mockResolvedValue(
			row({
				metadata: JSON.stringify({ category: "memory", memoryFilters: "not-an-object" }),
			})
		);
		await expect(readRememberedMemoryFilters("abc")).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("treats malformed metadata JSON as empty when reading port links", async () => {
		mockFindFirst.mockResolvedValue(row({ metadata: "{not json" }));
		await expect(readMemoryPortLinks("abc")).resolves.toEqual([]);
	});

	it("treats a missing metadata string as empty when reading port links", async () => {
		mockFindFirst.mockResolvedValue(row({ metadata: "" }));
		await expect(readMemoryPortLinks("abc")).resolves.toEqual([]);
	});

	it("treats a missing metadata string as an empty object when recording port links", async () => {
		mockFindFirst.mockResolvedValue(row({ metadata: "" }));
		mockUpdate.mockResolvedValue(row());
		await recordMemoryPortLinks("abc", [
			{
				sourceConnectorId: "memory:src",
				sourceMemoryId: "m1",
				copiedAt: "2026-08-18T00:00:00.000Z",
				contentFingerprint: "fp1",
			},
		]);
		const metadata = JSON.parse(mockUpdate.mock.calls[0][0].data.metadata);
		expect(metadata.memoryPorts).toHaveLength(1);
	});

	it("treats a missing metadata string as empty when reading remembered filters", async () => {
		mockFindFirst.mockResolvedValue(row({ metadata: "" }));
		await expect(readRememberedMemoryFilters("abc")).resolves.toEqual({
			users: [],
			sessions: [],
			agents: [],
		});
	});

	it("treats a missing existing metadata string as empty when remembering filters", async () => {
		mockFindFirst.mockResolvedValue(row({ metadata: "" }));
		mockUpdate.mockResolvedValue(row());
		await rememberMemoryFilters("abc", { users: ["ada"] });
		expect(JSON.parse(mockUpdate.mock.calls[0][0].data.metadata).memoryFilters).toEqual({
			users: ["ada"],
			sessions: [],
			agents: [],
		});
	});

	it("treats malformed settings JSON as an empty object in the runtime descriptor", async () => {
		mockFindFirst.mockResolvedValue(row({ settings: "{not json" }));
		mockCreateMemoryAdapter.mockReturnValue({ healthCheck: async () => ({ ok: true }) });
		await getMemoryRuntime("abc");
		expect(mockCreateMemoryAdapter.mock.calls[0][0].settings).toEqual({});
	});

	it("treats settings that parse to a JSON array as an empty object in the runtime descriptor", async () => {
		mockFindFirst.mockResolvedValue(row({ settings: "[1,2,3]" }));
		mockCreateMemoryAdapter.mockReturnValue({ healthCheck: async () => ({ ok: true }) });
		await getMemoryRuntime("abc");
		expect(mockCreateMemoryAdapter.mock.calls[0][0].settings).toEqual({});
	});

	it("treats settings that parse to a non-object primitive as an empty object in the runtime descriptor", async () => {
		mockFindFirst.mockResolvedValue(row({ settings: "42" }));
		mockCreateMemoryAdapter.mockReturnValue({ healthCheck: async () => ({ ok: true }) });
		await getMemoryRuntime("abc");
		expect(mockCreateMemoryAdapter.mock.calls[0][0].settings).toEqual({});
	});

	it("treats metadata that parses to a non-object primitive as empty when reading port links", async () => {
		mockFindFirst.mockResolvedValue(row({ metadata: "42" }));
		await expect(readMemoryPortLinks("abc")).resolves.toEqual([]);
	});

	it("skips a malformed entry already stored in metadata when recording new port links", async () => {
		mockFindFirst.mockResolvedValue(
			row({
				metadata: JSON.stringify({
					memoryPorts: [{ sourceConnectorId: "", sourceMemoryId: "" }],
				}),
			})
		);
		mockUpdate.mockResolvedValue(row());
		await recordMemoryPortLinks("abc", [
			{
				sourceConnectorId: "memory:src",
				sourceMemoryId: "m1",
				copiedAt: "2026-08-18T00:00:00.000Z",
				contentFingerprint: "fp1",
			},
		]);
		const stored = JSON.parse(mockUpdate.mock.calls[0][0].data.metadata).memoryPorts;
		expect(stored).toHaveLength(1);
	});

	it("defaults sanitized metadata to an empty object when the stored row has none", async () => {
		mockCreate.mockResolvedValue(row({ metadata: null as unknown as string }));
		const created = await createMemoryConnector({ name: "Prod Mem0", type: "mem0" });
		expect(JSON.parse(created.metadata)).toEqual({});
	});

	it("rejects a type marked internal by its descriptor", async () => {
		mockGetMemoryTypeDescriptor.mockReturnValue({ type: "internal-only", internal: true });
		await expect(
			createMemoryConnector({ name: "X", type: "internal-only" })
		).rejects.toThrow(/unknown memory connector/i);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("ignores credentials whose values are all blank or non-string", async () => {
		mockCreate.mockResolvedValue(row({ secretRef: null }));
		await createMemoryConnector({
			name: "Prod Mem0",
			type: "mem0",
			credentials: { apiKey: "   ", count: 5 },
		});
		expect(mockCreate.mock.calls[0][0].data.secretRef).toBeNull();
	});

	it("leaves environment/organisationId nullish when the stored row has none", async () => {
		mockFindFirst.mockResolvedValue(
			row({ organisationId: null, environment: "", secretRef: null })
		);
		mockCreateMemoryAdapter.mockReturnValue({ healthCheck: async () => ({ ok: true }) });
		const runtime = await getMemoryRuntime("abc");
		expect(runtime.connector.organisationId).toBeNull();
		expect(runtime.connector.hasSecret).toBe(false);
		expect(mockCreateMemoryAdapter.mock.calls[0][0].environment).toBeUndefined();
	});

	it("skips invalidating the secret cache when deleting a connector without a secretRef", async () => {
		mockFindFirst.mockResolvedValue(row({ secretRef: null }));
		mockDelete.mockResolvedValue({});
		await deleteMemoryConnector("abc");
		expect(mockDelete).toHaveBeenCalled();
	});

	it("rejects deleting a connector that no longer exists", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(deleteMemoryConnector("missing")).rejects.toThrow(/not found/i);
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it("throws when reading port links for a missing connector", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(readMemoryPortLinks("missing")).rejects.toThrow(/not found/i);
	});

	it("resolves an empty id to just the memory connector prefix", () => {
		expect(isMemoryConnectorId("")).toBe(false);
	});
});
