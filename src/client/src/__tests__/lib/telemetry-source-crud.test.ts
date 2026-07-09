const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockDelete = jest.fn();
const mockGetCurrentOrganisation = jest.fn();
const mockGetCurrentProjectForOrganisation = jest.fn();
const mockHasAdapterFactory = jest.fn();
const mockGetSourceTypeDescriptor = jest.fn();
const mockListSourceTypeDescriptors = jest.fn();
const mockCreateAdapter = jest.fn();

const mockBindingFindMany = jest.fn();
const mockBindingUpsert = jest.fn();
const mockBindingDeleteMany = jest.fn();
const mockUpsertSecret = jest.fn();

const mockTxBindingUpsert = jest.fn();

const txClient = {
	telemetrySource: {
		updateMany: (...a: unknown[]) => mockUpdateMany(...a),
		create: (...a: unknown[]) => mockCreate(...a),
		update: (...a: unknown[]) => mockUpdate(...a),
		delete: (...a: unknown[]) => mockDelete(...a),
	},
	telemetrySourceBinding: {
		upsert: (...a: unknown[]) => mockTxBindingUpsert(...a),
	},
};

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		telemetrySource: {
			findMany: (...a: unknown[]) => mockFindMany(...a),
			findFirst: (...a: unknown[]) => mockFindFirst(...a),
			delete: (...a: unknown[]) => mockDelete(...a),
		},
		telemetrySourceBinding: {
			findMany: (...a: unknown[]) => mockBindingFindMany(...a),
			upsert: (...a: unknown[]) => mockBindingUpsert(...a),
			deleteMany: (...a: unknown[]) => mockBindingDeleteMany(...a),
		},
		$transaction: (fn: (tx: unknown) => unknown) => fn(txClient),
	},
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: (...a: unknown[]) => mockGetCurrentOrganisation(...a),
	getCurrentProjectForOrganisation: (...a: unknown[]) =>
		mockGetCurrentProjectForOrganisation(...a),
}));

jest.mock("@/lib/db-config", () => ({
	getDBConfigByUser: jest.fn(),
	getDBConfigById: jest.fn(),
}));

jest.mock("@/lib/platform/datasource/bootstrap", () => ({
	ensureAdaptersRegistered: jest.fn(),
}));

jest.mock("@/lib/platform/datasource/registry", () => ({
	hasAdapterFactory: (...a: unknown[]) => mockHasAdapterFactory(...a),
	getSourceTypeDescriptor: (...a: unknown[]) => mockGetSourceTypeDescriptor(...a),
	listSourceTypeDescriptors: (...a: unknown[]) =>
		mockListSourceTypeDescriptors(...a),
	createAdapter: (...a: unknown[]) => mockCreateAdapter(...a),
}));

jest.mock("@/lib/platform/vault", () => ({
	upsertSecret: (...a: unknown[]) => mockUpsertSecret(...a),
}));

jest.mock("@/utils/log", () => ({ consoleLog: jest.fn() }));

import {
	availableSourceTypes,
	createSourceStack,
	createTelemetrySource,
	deleteTelemetrySource,
	deleteTelemetrySourceBinding,
	healthCheckTelemetrySource,
	listStackTemplates,
	listTelemetrySources,
	listTelemetrySourceBindings,
	setTelemetrySourceBinding,
	updateTelemetrySource,
	validateTelemetrySourceAISignal,
} from "@/lib/telemetry-source-crud";

const row = (over: Record<string, unknown> = {}) => ({
	id: "src-1",
	projectId: "proj-1",
	name: "Prod DD",
	type: "datadog",
	signals: "traces,logs,metrics",
	settings: "{}",
	secretRef: "vault-1",
	isDefault: false,
	createdAt: new Date(),
	updatedAt: new Date(),
	createdByUserId: "u1",
	...over,
});

beforeEach(() => {
	jest.clearAllMocks();
	mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
	mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
	mockUpsertSecret.mockResolvedValue({ id: "vault-new" });
	mockHasAdapterFactory.mockReturnValue(true);
	mockGetSourceTypeDescriptor.mockImplementation((type: string) => ({
		type,
		displayName: type,
		declaredSignals:
			type === "tempo"
				? ["traces"]
				: type === "prometheus"
					? ["metrics"]
					: ["traces", "logs", "metrics"],
		capabilities: {
			traceTree: true,
			spanEvents: false,
			serverAggregation: true,
			spanMutation: false,
			distinctValues: true,
			crossTraceSession: false,
			rawQuery: false,
		},
		correlation: { crossSignal: true, keys: ["traceId", "service"] },
	}));
	mockListSourceTypeDescriptors.mockReturnValue([
		{ type: "clickhouse" },
		{ type: "datadog" },
		{ type: "tempo" },
	]);
});

describe("listTelemetrySources", () => {
	it("scopes to the current project and strips the secret ref", async () => {
		mockFindMany.mockResolvedValue([row(), row({ id: "src-2", secretRef: null })]);
		const sources = await listTelemetrySources();
		expect(mockFindMany).toHaveBeenCalledWith({
			where: { projectId: "proj-1" },
			orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
		});
		expect(sources[0]).not.toHaveProperty("secretRef");
		expect(sources[0].hasSecret).toBe(true);
		expect(sources[1].hasSecret).toBe(false);
	});

	it("denies when the user has no current project (membership)", async () => {
		mockGetCurrentProjectForOrganisation.mockResolvedValue(null);
		await expect(listTelemetrySources()).rejects.toThrow();
		expect(mockFindMany).not.toHaveBeenCalled();
	});
});

describe("availableSourceTypes", () => {
	it("returns the registered adapter types", () => {
		expect(availableSourceTypes()).toEqual(["clickhouse", "datadog", "tempo"]);
	});
});

describe("createTelemetrySource", () => {
	it("creates a project-scoped source and normalizes signals/settings", async () => {
		mockCreate.mockResolvedValue(row());
		await createTelemetrySource({
			name: "Prod DD",
			type: "datadog",
			signals: ["traces", "logs"],
			settings: { site: "datadoghq.com" },
		});
		const arg = mockCreate.mock.calls[0][0];
		expect(arg.data).toMatchObject({
			projectId: "proj-1",
			name: "Prod DD",
			type: "datadog",
			signals: "traces,logs",
			settings: '{"site":"datadoghq.com"}',
			isDefault: false,
		});
	});

	it("rejects a blank name", async () => {
		await expect(
			createTelemetrySource({ name: "  ", type: "datadog" })
		).rejects.toThrow();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("rejects an unknown source type", async () => {
		mockHasAdapterFactory.mockReturnValue(false);
		await expect(
			createTelemetrySource({ name: "X", type: "splunk" })
		).rejects.toThrow();
	});

	it("rejects non-object settings", async () => {
		await expect(
			createTelemetrySource({ name: "X", type: "datadog", settings: "[1,2]" })
		).rejects.toThrow();
	});

	it("rejects a signal the source type cannot serve", async () => {
		await expect(
			createTelemetrySource({ name: "T", type: "tempo", signals: ["logs"] })
		).rejects.toThrow();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("defaults to the type's declared signals when none are given", async () => {
		mockCreate.mockResolvedValue(row({ type: "tempo", signals: "traces" }));
		await createTelemetrySource({ name: "T", type: "tempo" });
		expect(mockCreate.mock.calls[0][0].data.signals).toBe("traces");
	});

	it("persists inline credentials to the vault and stores only the secret id", async () => {
		mockCreate.mockResolvedValue(row());
		await createTelemetrySource({
			name: "Prod DD",
			type: "datadog",
			credentials: { apiKey: "dd-key", appKey: "dd-app", empty: "  " },
		});
		expect(mockUpsertSecret).toHaveBeenCalledTimes(1);
		const secretArg = mockUpsertSecret.mock.calls[0][0];
		// Blank values are stripped; only real credentials are persisted.
		expect(JSON.parse(secretArg.value)).toEqual({
			apiKey: "dd-key",
			appKey: "dd-app",
		});
		// The vault secret id is stored, never the raw credentials.
		expect(mockCreate.mock.calls[0][0].data.secretRef).toBe("vault-new");
	});

	it("does not touch the vault when no non-empty credentials are given", async () => {
		mockCreate.mockResolvedValue(row());
		await createTelemetrySource({
			name: "Prod DD",
			type: "datadog",
			credentials: { apiKey: "   " },
			secretRef: "explicit-ref",
		});
		expect(mockUpsertSecret).not.toHaveBeenCalled();
		expect(mockCreate.mock.calls[0][0].data.secretRef).toBe("explicit-ref");
	});

	it("unsets the previous default when creating a new default", async () => {
		mockCreate.mockResolvedValue(row({ isDefault: true }));
		await createTelemetrySource({
			name: "Prod DD",
			type: "datadog",
			isDefault: true,
		});
		expect(mockUpdateMany).toHaveBeenCalledWith({
			where: { projectId: "proj-1", isDefault: true },
			data: { isDefault: false },
		});
	});
});

describe("updateTelemetrySource", () => {
	it("denies updating a source outside the current project", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(
			updateTelemetrySource("src-other", { name: "hacked" })
		).rejects.toThrow();
		expect(mockUpdate).not.toHaveBeenCalled();
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { id: "src-other", projectId: "proj-1" },
		});
	});

	it("updates only provided fields for an owned source", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row({ name: "Renamed" }));
		await updateTelemetrySource("src-1", { name: "Renamed" });
		expect(mockUpdate).toHaveBeenCalledWith({
			where: { id: "src-1" },
			data: { name: "Renamed" },
		});
	});

	it("promotes to default and demotes siblings", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row({ isDefault: true }));
		await updateTelemetrySource("src-1", { isDefault: true });
		expect(mockUpdateMany).toHaveBeenCalledWith({
			where: { projectId: "proj-1", isDefault: true, NOT: { id: "src-1" } },
			data: { isDefault: false },
		});
		expect(mockUpdate.mock.calls[0][0].data.isDefault).toBe(true);
	});
});

describe("deleteTelemetrySource", () => {
	it("denies deleting a source outside the current project", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(deleteTelemetrySource("src-other")).rejects.toThrow();
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it("deletes an owned source", async () => {
		mockFindFirst.mockResolvedValue(row());
		await deleteTelemetrySource("src-1");
		expect(mockDelete).toHaveBeenCalledWith({ where: { id: "src-1" } });
	});
});

describe("healthCheckTelemetrySource", () => {
	it("binds the adapter and returns its health", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateAdapter.mockReturnValue({
			healthCheck: jest.fn().mockResolvedValue({ ok: true }),
		});
		expect(await healthCheckTelemetrySource("src-1")).toEqual({ ok: true });
	});

	it("returns not-ok when no adapter is registered for the type", async () => {
		mockFindFirst.mockResolvedValue(row({ type: "unknownvendor" }));
		mockCreateAdapter.mockReturnValue(undefined);
		const res = await healthCheckTelemetrySource("src-1");
		expect(res.ok).toBe(false);
	});
});

describe("validateTelemetrySourceAISignal", () => {
	it("delegates to the adapter's validateAISignal", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateAdapter.mockReturnValue({
			validateAISignal: jest
				.fn()
				.mockResolvedValue({ ok: true, sampleCount: 3, missingAttributes: [] }),
		});
		const res = await validateTelemetrySourceAISignal("src-1", {
			start: new Date("2026-07-01"),
			end: new Date("2026-07-02"),
		});
		expect(res).toMatchObject({ ok: true, sampleCount: 3 });
	});
});

describe("telemetry source bindings", () => {
	it("lists the current project's bindings", async () => {
		mockBindingFindMany.mockResolvedValue([
			{
				id: "b1",
				signal: "traces",
				sourceId: "src-1",
				source: { name: "Prod DD", type: "datadog" },
			},
		]);
		const bindings = await listTelemetrySourceBindings();
		expect(mockBindingFindMany).toHaveBeenCalledWith({
			where: { projectId: "proj-1" },
			include: { source: true },
			orderBy: { signal: "asc" },
		});
		expect(bindings[0]).toMatchObject({
			signal: "traces",
			sourceId: "src-1",
			sourceName: "Prod DD",
			sourceType: "datadog",
		});
	});

	it("binds a signal to a source that serves it (project-scoped)", async () => {
		mockFindFirst.mockResolvedValue(row({ signals: "traces,logs,metrics" }));
		mockBindingUpsert.mockResolvedValue({
			id: "b1",
			signal: "traces",
			sourceId: "src-1",
		});
		await setTelemetrySourceBinding("traces", "src-1");
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { id: "src-1", projectId: "proj-1" },
		});
		expect(mockBindingUpsert).toHaveBeenCalledWith({
			where: { projectId_signal: { projectId: "proj-1", signal: "traces" } },
			create: { projectId: "proj-1", signal: "traces", sourceId: "src-1" },
			update: { sourceId: "src-1" },
		});
	});

	it("rejects binding a signal the source does not serve", async () => {
		mockFindFirst.mockResolvedValue(row({ signals: "metrics" }));
		await expect(
			setTelemetrySourceBinding("traces", "src-1")
		).rejects.toThrow();
		expect(mockBindingUpsert).not.toHaveBeenCalled();
	});

	it("rejects binding to a source outside the current project", async () => {
		mockFindFirst.mockResolvedValue(null);
		await expect(
			setTelemetrySourceBinding("traces", "src-other")
		).rejects.toThrow();
	});

	it("rejects an unknown signal", async () => {
		await expect(
			setTelemetrySourceBinding("bogus", "src-1")
		).rejects.toThrow();
	});

	it("deletes a signal binding (project-scoped)", async () => {
		mockBindingDeleteMany.mockResolvedValue({ count: 1 });
		await deleteTelemetrySourceBinding("logs");
		expect(mockBindingDeleteMany).toHaveBeenCalledWith({
			where: { projectId: "proj-1", signal: "logs" },
		});
	});
});

describe("createSourceStack", () => {
	it("lists stack templates", () => {
		const templates = listStackTemplates().map((t) => t.template);
		expect(templates).toEqual(expect.arrayContaining(["grafana", "victoria"]));
	});

	it("creates atomic member rows and binds each member's signals", async () => {
		mockCreate.mockImplementation((arg: any) =>
			Promise.resolve({ id: `src-${arg.data.type}`, ...arg.data })
		);
		mockTxBindingUpsert.mockResolvedValue({});

		const res = await createSourceStack({
			name: "Grafana Prod",
			members: [
				{ type: "tempo", settings: { url: "https://tempo" } },
				{ type: "loki", signals: ["logs"], settings: { url: "https://loki" } },
				{ type: "mimir", signals: ["metrics"], settings: { url: "https://mimir" } },
			],
		});

		expect(mockCreate).toHaveBeenCalledTimes(3);
		// tempo defaults to its declared [traces]; loki -> logs; mimir -> metrics.
		expect(mockTxBindingUpsert).toHaveBeenCalledWith({
			where: { projectId_signal: { projectId: "proj-1", signal: "traces" } },
			create: { projectId: "proj-1", signal: "traces", sourceId: "src-tempo" },
			update: { sourceId: "src-tempo" },
		});
		expect(mockTxBindingUpsert).toHaveBeenCalledWith({
			where: { projectId_signal: { projectId: "proj-1", signal: "logs" } },
			create: { projectId: "proj-1", signal: "logs", sourceId: "src-loki" },
			update: { sourceId: "src-loki" },
		});
		expect(res.sources).toHaveLength(3);
	});

	it("does not bind when bind is false", async () => {
		mockCreate.mockImplementation((arg: any) =>
			Promise.resolve({ id: `src-${arg.data.type}`, ...arg.data })
		);
		await createSourceStack({
			name: "Grafana Prod",
			bind: false,
			members: [{ type: "tempo", settings: { url: "https://tempo" } }],
		});
		expect(mockTxBindingUpsert).not.toHaveBeenCalled();
	});

	it("rejects an empty member list", async () => {
		await expect(
			createSourceStack({ name: "X", members: [] })
		).rejects.toThrow();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("validates members before any write (unknown type)", async () => {
		mockHasAdapterFactory.mockImplementation((t: string) => t !== "splunk");
		await expect(
			createSourceStack({
				name: "X",
				members: [
					{ type: "tempo", settings: {} },
					{ type: "splunk", settings: {} },
				],
			})
		).rejects.toThrow();
		expect(mockCreate).not.toHaveBeenCalled();
	});
});
