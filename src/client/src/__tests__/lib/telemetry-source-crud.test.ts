const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockDelete = jest.fn();
const mockConnectorUpsert = jest.fn();
const mockGetCurrentOrganisation = jest.fn();
const mockGetCurrentProjectForOrganisation = jest.fn();
const mockHasAdapterFactory = jest.fn();
const mockGetSourceTypeDescriptor = jest.fn();
const mockListSourceTypeDescriptors = jest.fn();
const mockCreateAdapter = jest.fn();

const mockBindingFindMany = jest.fn();
const mockBindingFindUnique = jest.fn();
const mockBindingFindFirst = jest.fn();
const mockBindingUpsert = jest.fn();
const mockBindingDeleteMany = jest.fn();
const mockUpsertSecret = jest.fn();
const mockGetSecretById = jest.fn();
const mockDatabaseConfigFindFirst = jest.fn();
const mockGetDBConfigByUser = jest.fn();
const mockGetDBConfigById = jest.fn();

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
	connectorInstance: {
		upsert: (...a: unknown[]) => mockConnectorUpsert(...a),
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
			findUnique: (...a: unknown[]) => mockBindingFindUnique(...a),
			findFirst: (...a: unknown[]) => mockBindingFindFirst(...a),
			upsert: (...a: unknown[]) => mockBindingUpsert(...a),
			deleteMany: (...a: unknown[]) => mockBindingDeleteMany(...a),
		},
		databaseConfig: {
			findFirst: (...a: unknown[]) => mockDatabaseConfigFindFirst(...a),
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
	getDBConfigByUser: (...a: unknown[]) => mockGetDBConfigByUser(...a),
	getDBConfigById: (...a: unknown[]) => mockGetDBConfigById(...a),
}));

jest.mock("@/lib/platform/connectors/datasource/bootstrap", () => ({
	ensureAdaptersRegistered: jest.fn(),
}));

jest.mock("@/lib/platform/connectors/datasource/registry", () => ({
	hasAdapterFactory: (...a: unknown[]) => mockHasAdapterFactory(...a),
	getSourceTypeDescriptor: (...a: unknown[]) => mockGetSourceTypeDescriptor(...a),
	listSourceTypeDescriptors: (...a: unknown[]) =>
		mockListSourceTypeDescriptors(...a),
	createAdapter: (...a: unknown[]) => mockCreateAdapter(...a),
}));

jest.mock("@/lib/platform/vault", () => ({
	upsertSecret: (...a: unknown[]) => mockUpsertSecret(...a),
	getSecretById: (...a: unknown[]) => mockGetSecretById(...a),
}));

jest.mock("@/lib/platform/connectors/instances", () => ({
	syncTelemetrySourceConnector: jest.fn().mockResolvedValue(undefined),
	removeLegacyConnector: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/project-environment", () => ({
	createProjectEnvironment: jest.fn().mockResolvedValue({ id: "env-1" }),
}));

jest.mock("@/utils/log", () => ({ consoleLog: jest.fn() }));

import {
	availableSourceTypeDescriptors,
	availableSourceTypes,
	createTelemetrySource,
	deleteTelemetrySource,
	deleteTelemetrySourceBinding,
	healthCheckTelemetrySource,
	listTelemetrySources,
	listTelemetrySourceBindings,
	normalizeTelemetrySourceId,
	resolveProjectSignalCapabilities,
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
	mockGetSecretById.mockResolvedValue({ data: [{ id: "vault-1" }] });
	mockHasAdapterFactory.mockReturnValue(true);
	mockFindFirst.mockResolvedValue(null);
	mockBindingFindUnique.mockResolvedValue(null);
	mockBindingFindFirst.mockResolvedValue(null);
	mockDatabaseConfigFindFirst.mockReset().mockResolvedValue(null);
	mockGetDBConfigByUser.mockReset();
	mockGetDBConfigById.mockReset();
	mockConnectorUpsert.mockResolvedValue({});
	mockGetSourceTypeDescriptor.mockImplementation((type: string) => ({
		type,
		displayName: type,
		declaredSignals:
			type === "tempo"
				? ["traces"]
				: type === "prometheus" || type === "loki"
					? type === "loki"
						? ["logs"]
						: ["metrics"]
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
	mockListSourceTypeDescriptors.mockImplementation(
		(opts: { includeInternal?: boolean } = {}) => {
			return [
				{ type: "clickhouse" },
				{ type: "tempo" },
				{ type: "jaeger" },
			];
		}
	);
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

	it("denies when there is no current organisation at all", async () => {
		mockGetCurrentOrganisation.mockResolvedValue(null);
		await expect(listTelemetrySources()).rejects.toThrow();
		expect(mockFindMany).not.toHaveBeenCalled();
	});
});

describe("normalizeTelemetrySourceId", () => {
	it("strips a single connector-registry prefix", () => {
		expect(normalizeTelemetrySourceId("telemetry:src-1")).toBe("src-1");
	});

	it("strips repeated connector-registry prefixes", () => {
		expect(normalizeTelemetrySourceId("telemetry:telemetry:src-1")).toBe(
			"src-1"
		);
	});

	it("leaves an unprefixed id untouched", () => {
		expect(normalizeTelemetrySourceId("src-1")).toBe("src-1");
	});
});

describe("availableSourceTypes", () => {
	it("returns the registered adapter types", () => {
		expect(availableSourceTypes()).toEqual(["clickhouse", "tempo", "jaeger"]);
	});
});

describe("availableSourceTypeDescriptors", () => {
	it("fills in a description and icon for each registered type", () => {
		mockListSourceTypeDescriptors.mockReturnValue([
			{ type: "tempo", displayName: "Tempo" },
			{ type: "custom-vendor", displayName: "Custom", description: "Already described", icon: "/already.svg" },
		]);
		const descriptors = availableSourceTypeDescriptors();
		expect(descriptors[0]).toMatchObject({ type: "tempo" });
		expect(typeof descriptors[0].description).toBe("string");
		expect(descriptors[0].description.length).toBeGreaterThan(0);
		// A descriptor that already supplies a description/icon keeps it as-is.
		expect(descriptors[1]).toMatchObject({
			description: "Already described",
			icon: "/already.svg",
		});
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

	it("rejects a duplicate name in the same environment", async () => {
		mockFindFirst.mockResolvedValue({ id: "src-existing" });
		await expect(
			createTelemetrySource({
				name: "prod-loki",
				type: "loki",
				environment: "production",
			})
		).rejects.toThrow(/already exists/);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("syncs the connector instance inside the create transaction", async () => {
		mockCreate.mockResolvedValue(row({ id: "src-loki", type: "loki", name: "local-loki", signals: "logs" }));
		await createTelemetrySource({
			name: "local-loki",
			type: "loki",
			environment: "production",
			settings: { url: "http://localhost:3100" },
		});
		expect(mockConnectorUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "telemetry:src-loki" },
				create: expect.objectContaining({
					type: "loki",
					name: "local-loki",
				}),
			})
		);
	});

	it("preserves an explicit environment on the synced connector instance", async () => {
		mockCreate.mockResolvedValue(
			row({ id: "src-stg", type: "loki", name: "staging-loki", signals: "logs", environment: "staging" })
		);
		await createTelemetrySource({
			name: "staging-loki",
			type: "loki",
			environment: "staging",
		});
		expect(mockConnectorUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				create: expect.objectContaining({ environment: "staging" }),
				update: expect.objectContaining({ environment: "staging" }),
			})
		);
	});

	it("normalizes collapsed endpoint URLs before persist", async () => {
		mockCreate.mockResolvedValue(row({ id: "src-prom", type: "prometheus", name: "local-prometheus", signals: "metrics" }));
		await createTelemetrySource({
			name: "local-prometheus",
			type: "prometheus",
			environment: "production",
			settings: { url: "http:/localhost:9090", allowPrivateNetwork: true },
		});
		expect(mockCreate.mock.calls[0][0].data.settings).toContain(
			'"url":"http://localhost:9090"'
		);
	});

	it("rejects an unknown source type", async () => {
		mockHasAdapterFactory.mockReturnValue(false);
		await expect(
			createTelemetrySource({ name: "X", type: "splunk" })
		).rejects.toThrow();
	});

	it("rejects a blank source type", async () => {
		await expect(
			createTelemetrySource({ name: "X", type: "" })
		).rejects.toThrow();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("allows a registered type even when its descriptor is unavailable for the internal check", async () => {
		mockGetSourceTypeDescriptor.mockReturnValueOnce(undefined).mockImplementation((type: string) => ({
			type,
			displayName: type,
			declaredSignals: ["traces", "logs", "metrics"],
			capabilities: {
				traceTree: true,
				spanEvents: false,
				serverAggregation: true,
				spanMutation: false,
				distinctValues: true,
				crossTraceSession: false,
				rawQuery: false,
			},
		}));
		mockCreate.mockResolvedValue(row({ type: "mystery" }));
		await expect(
			createTelemetrySource({ name: "Mystery", type: "mystery" })
		).resolves.toMatchObject({ type: "mystery" });
	});

	it("rejects non-object settings", async () => {
		await expect(
			createTelemetrySource({ name: "X", type: "datadog", settings: "[1,2]" })
		).rejects.toThrow();
	});

	it("rejects malformed JSON settings", async () => {
		await expect(
			createTelemetrySource({ name: "X", type: "datadog", settings: "{not-json" })
		).rejects.toThrow(/JSON object/);
	});

	it("rejects a non-object, non-string settings value", async () => {
		await expect(
			createTelemetrySource({ name: "X", type: "datadog", settings: 42 })
		).rejects.toThrow(/JSON object/);
	});

	it("accepts settings passed as a valid JSON string and normalizes the endpoint URL", async () => {
		mockCreate.mockResolvedValue(row({ id: "src-prom2", type: "prometheus", signals: "metrics" }));
		await createTelemetrySource({
			name: "prom-str-settings",
			type: "prometheus",
			settings: '{"url":"http:/localhost:9090"}',
		});
		expect(mockCreate.mock.calls[0][0].data.settings).toContain(
			'"url":"http://localhost:9090"'
		);
	});

	it("accepts signals passed as a comma-separated string", async () => {
		mockCreate.mockResolvedValue(row({ signals: "traces,logs" }));
		await createTelemetrySource({
			name: "Prod DD",
			type: "datadog",
			signals: "traces, logs",
		});
		expect(mockCreate.mock.calls[0][0].data.signals).toBe("traces,logs");
	});

	it("falls back to all signals for a non-array, non-string signals value, then rejects one the type cannot serve", async () => {
		// rawSignals(42) falls back to parseSignals(undefined) -> every signal,
		// including "intelligence" which datadog's declared set does not cover.
		await expect(
			createTelemetrySource({
				name: "Prod DD",
				type: "datadog",
				signals: 42 as unknown as string,
			})
		).rejects.toThrow(/cannot serve/);
	});

	it("defaults declared signals to traces/logs/metrics when the type descriptor is unavailable", async () => {
		// First call is validateType's `.internal` check; second is
		// normalizeSignalsForType's declared-signals lookup, which we want to
		// miss so the hard-coded fallback default applies.
		mockGetSourceTypeDescriptor
			.mockImplementationOnce((t: string) => ({ type: t, internal: false }))
			.mockReturnValueOnce(undefined);
		mockCreate.mockResolvedValue(row({ type: "mystery", signals: "traces,logs,metrics" }));
		await createTelemetrySource({ name: "Mystery", type: "mystery" });
		expect(mockCreate.mock.calls[0][0].data.signals).toBe("traces,logs,metrics");
	});

	it("rejects an internal-only registered type", async () => {
		mockGetSourceTypeDescriptor.mockReturnValue({
			type: "internal-type",
			internal: true,
			declaredSignals: ["traces"],
		});
		await expect(
			createTelemetrySource({ name: "X", type: "internal-type" })
		).rejects.toThrow();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("converts a unique-constraint P2002 transaction error into a friendly name-taken error", async () => {
		mockCreate.mockRejectedValue(
			Object.assign(new Error("unique violation"), { code: "P2002" })
		);
		await expect(
			createTelemetrySource({ name: "Prod DD", type: "datadog" })
		).rejects.toThrow(/already exists/);
	});

	it("converts a raw 'Unique constraint failed' message into a friendly name-taken error", async () => {
		mockCreate.mockRejectedValue(new Error("Unique constraint failed on the fields: (`name`)"));
		await expect(
			createTelemetrySource({ name: "Prod DD", type: "datadog" })
		).rejects.toThrow(/already exists/);
	});

	it("rethrows a non-unique-constraint transaction error unchanged", async () => {
		mockCreate.mockRejectedValue(new Error("connection reset"));
		await expect(
			createTelemetrySource({ name: "Prod DD", type: "datadog" })
		).rejects.toThrow("connection reset");
	});

	it("rethrows a non-Error transaction rejection unchanged", async () => {
		mockCreate.mockRejectedValue("plain string failure");
		await expect(
			createTelemetrySource({ name: "Prod DD", type: "datadog" })
		).rejects.toBe("plain string failure");
	});

	it("does not misclassify an error object with a falsy code as a unique-constraint violation", async () => {
		mockCreate.mockRejectedValue(
			Object.assign(new Error("some other failure"), { code: "" })
		);
		await expect(
			createTelemetrySource({ name: "Prod DD", type: "datadog" })
		).rejects.toThrow("some other failure");
	});

	it("rethrows a falsy non-Error transaction rejection unchanged", async () => {
		mockCreate.mockRejectedValue("");
		await expect(
			createTelemetrySource({ name: "Prod DD", type: "datadog" })
		).rejects.toBe("");
	});

	it("rejects a completely missing name", async () => {
		await expect(
			createTelemetrySource({ type: "datadog" })
		).rejects.toThrow();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("falls back to no secretRef when the vault returns a bare string instead of an object", async () => {
		mockCreate.mockResolvedValue(row());
		mockUpsertSecret.mockResolvedValueOnce("raw-secret-id" as unknown as { id?: string });
		await createTelemetrySource({
			name: "Prod DD",
			type: "datadog",
			credentials: { apiKey: "dd-key" },
		});
		expect(mockCreate.mock.calls[0][0].data.secretRef).toBeNull();
	});

	it("rejects an environment string with invalid characters", async () => {
		await expect(
			createTelemetrySource({
				name: "Prod DD",
				type: "datadog",
				environment: "bad env!",
			})
		).rejects.toThrow(/Environment must use/);
		expect(mockCreate).not.toHaveBeenCalled();
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

	it("rejects a vault secret that is not owned by the current user", async () => {
		mockGetSecretById.mockResolvedValue({ data: [] });
		await expect(
			createTelemetrySource({
				name: "Untrusted source",
				type: "datadog",
				secretRef: "secret-from-another-user",
			})
		).rejects.toThrow("not owned by the current user");
		expect(mockCreate).not.toHaveBeenCalled();
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

	it("explicitly demotes a source from default without promoting another", async () => {
		mockFindFirst.mockResolvedValue(row({ isDefault: true }));
		mockUpdate.mockResolvedValue(row({ isDefault: false }));
		await updateTelemetrySource("src-1", { isDefault: false });
		expect(mockUpdateMany).not.toHaveBeenCalled();
		expect(mockUpdate.mock.calls[0][0].data.isDefault).toBe(false);
	});

	it("normalizes and persists an environment change, provisioning it first", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row({ environment: "staging" }));
		await updateTelemetrySource("src-1", { environment: "Staging" });
		expect(mockUpdate.mock.calls[0][0].data.environment).toBe("staging");
	});

	it("re-validates the stored signals against the new type when the type changes without explicit signals", async () => {
		mockFindFirst.mockResolvedValue(row({ type: "datadog", signals: "traces" }));
		mockUpdate.mockResolvedValue(row({ type: "tempo", signals: "traces" }));
		await updateTelemetrySource("src-1", { type: "tempo" });
		expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
			type: "tempo",
			signals: "traces",
		});
	});

	it("rejects a type change when the existing stored signals are no longer valid for the new type", async () => {
		mockFindFirst.mockResolvedValue(row({ type: "datadog", signals: "traces,logs,metrics" }));
		await expect(
			updateTelemetrySource("src-1", { type: "tempo" })
		).rejects.toThrow(/cannot serve/);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("applies explicitly provided signals over the type's full declared set", async () => {
		mockFindFirst.mockResolvedValue(row({ type: "datadog", signals: "traces,logs,metrics" }));
		mockUpdate.mockResolvedValue(row({ signals: "logs" }));
		await updateTelemetrySource("src-1", { signals: ["logs"] });
		expect(mockUpdate.mock.calls[0][0].data.signals).toBe("logs");
	});

	it("repoints secretRef to a newly persisted vault credential", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row({ secretRef: "vault-new" }));
		await updateTelemetrySource("src-1", { credentials: { apiKey: "new-key" } });
		expect(mockUpsertSecret).toHaveBeenCalledTimes(1);
		expect(mockUpdate.mock.calls[0][0].data.secretRef).toBe("vault-new");
	});

	it("applies an explicit secretRef update when no inline credentials are given", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row({ secretRef: "explicit-ref" }));
		await updateTelemetrySource("src-1", { secretRef: "explicit-ref" });
		expect(mockUpsertSecret).not.toHaveBeenCalled();
		expect(mockUpdate.mock.calls[0][0].data.secretRef).toBe("explicit-ref");
	});

	it("clears secretRef when explicitly set to a non-string value", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row({ secretRef: null }));
		await updateTelemetrySource("src-1", { secretRef: null });
		expect(mockUpdate.mock.calls[0][0].data.secretRef).toBeNull();
	});

	it("rejects an explicitly blank (but defined) name on update", async () => {
		mockFindFirst.mockResolvedValue(row());
		await expect(updateTelemetrySource("src-1", { name: "" })).rejects.toThrow(
			/name is required/i
		);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("normalizes and persists updated settings", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockUpdate.mockResolvedValue(row({ settings: '{"url":"http://localhost:9090"}' }));
		await updateTelemetrySource("src-1", {
			settings: { url: "http:/localhost:9090" },
		});
		expect(mockUpdate.mock.calls[0][0].data.settings).toContain(
			'"url":"http://localhost:9090"'
		);
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

	it("attaches the active database config id to the adapter descriptor when one is bound", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockGetDBConfigByUser.mockResolvedValue({ id: "db-active" });
		mockCreateAdapter.mockReturnValue({
			healthCheck: jest.fn().mockResolvedValue({ ok: true }),
		});
		await healthCheckTelemetrySource("src-1");
		expect(mockCreateAdapter.mock.calls[0][0]).toMatchObject({
			dbConfigId: "db-active",
		});
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
		expect(res).toMatchObject({ ok: true, sampleCount: 3, supported: true });
	});

	it("soft-succeeds when the adapter does not support AI validation", async () => {
		const { UnsupportedCapabilityError } = jest.requireActual(
			"@/lib/platform/connectors/datasource/types"
		) as typeof import("@/lib/platform/connectors/datasource/types");
		mockFindFirst.mockResolvedValue(row({ type: "loki" }));
		mockCreateAdapter.mockReturnValue({
			validateAISignal: jest
				.fn()
				.mockRejectedValue(new UnsupportedCapabilityError("loki", "validateAISignal")),
		});
		const res = await validateTelemetrySourceAISignal("src-1", {
			start: new Date("2026-07-01"),
			end: new Date("2026-07-02"),
		});
		expect(res.supported).toBe(false);
		expect(res.ok).toBe(true);
	});

	it("rethrows a non-capability error from the adapter", async () => {
		mockFindFirst.mockResolvedValue(row());
		mockCreateAdapter.mockReturnValue({
			validateAISignal: jest.fn().mockRejectedValue(new Error("upstream 500")),
		});
		await expect(
			validateTelemetrySourceAISignal("src-1", {
				start: new Date("2026-07-01"),
				end: new Date("2026-07-02"),
			})
		).rejects.toThrow("upstream 500");
	});

	it("returns not-supported when no adapter is registered for the type", async () => {
		mockFindFirst.mockResolvedValue(row({ type: "unknownvendor" }));
		mockCreateAdapter.mockReturnValue(undefined);
		const res = await validateTelemetrySourceAISignal("src-1", {
			start: new Date("2026-07-01"),
			end: new Date("2026-07-02"),
		});
		expect(res).toMatchObject({ ok: false, supported: false, sampleCount: 0 });
	});
});

describe("resolveProjectSignalCapabilities", () => {
	it("reports null capabilities for every signal when nothing is routed", async () => {
		mockCreateAdapter.mockReturnValue(undefined);
		const result = await resolveProjectSignalCapabilities();
		expect(Object.keys(result)).toEqual(["traces", "logs", "metrics", "intelligence"]);
		for (const signal of Object.keys(result)) {
			expect(result[signal as keyof typeof result]).toMatchObject({
				sourceType: "clickhouse",
				isBuiltIn: true,
				capabilities: null,
			});
		}
	});

	it("drops the per-instance signals list from resolved capabilities", async () => {
		mockCreateAdapter.mockReturnValue({
			capabilities: () => ({
				signals: ["traces"],
				traceTree: true,
				spanEvents: false,
				serverAggregation: true,
				spanMutation: false,
				distinctValues: true,
				crossTraceSession: false,
				rawQuery: false,
			}),
		});
		const result = await resolveProjectSignalCapabilities();
		const traces = result.traces;
		expect(traces?.capabilities).not.toHaveProperty("signals");
		expect(traces?.capabilities).toMatchObject({ traceTree: true });
	});

	it("reports null for a signal whose resolution throws, without failing the others", async () => {
		mockBindingFindUnique.mockRejectedValueOnce(new Error("db unavailable"));
		mockCreateAdapter.mockReturnValue(undefined);
		const result = await resolveProjectSignalCapabilities("production");
		expect(result.traces).toBeNull();
		expect(result.logs).toMatchObject({ sourceType: "clickhouse" });
	});

	it("treats a bound source explicitly typed clickhouse as built-in even when not flagged as such", async () => {
		mockBindingFindUnique.mockResolvedValue({
			sourceId: "src-ch",
			databaseConfigId: null,
			source: {
				id: "src-ch",
				name: "Weird CH",
				type: "clickhouse",
				signals: "traces,logs,metrics,intelligence",
				settings: "{}",
				secretRef: null,
				projectId: "proj-1",
				environment: "production",
			},
			databaseConfig: null,
		});
		mockCreateAdapter.mockReturnValue(undefined);
		const result = await resolveProjectSignalCapabilities();
		expect(result.traces).toMatchObject({ sourceType: "clickhouse", isBuiltIn: true });
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
			where: { projectId: "proj-1", environment: "production" },
			include: { source: true, databaseConfig: true },
			orderBy: { signal: "asc" },
		});
		expect(bindings[0]).toMatchObject({
			signal: "traces",
			sourceId: "src-1",
			sourceName: "Prod DD",
			sourceType: "datadog",
		});
	});

	it("lists a builtin-bound signal without an external source", async () => {
		mockBindingFindMany.mockResolvedValue([
			{
				id: "b2",
				signal: "metrics",
				sourceId: null,
				databaseConfigId: "db-5",
				source: null,
				databaseConfig: { name: "Builtin CH" },
			},
		]);
		const bindings = await listTelemetrySourceBindings();
		expect(bindings[0]).toMatchObject({
			signal: "metrics",
			sourceId: "builtin:db-5",
			sourceName: "Builtin CH",
			sourceType: "clickhouse",
		});
	});

	it("lists a signal binding with no source and no database config at all", async () => {
		mockBindingFindMany.mockResolvedValue([
			{
				id: "b3",
				signal: "logs",
				sourceId: null,
				databaseConfigId: null,
				source: null,
				databaseConfig: null,
			},
		]);
		const bindings = await listTelemetrySourceBindings();
		expect(bindings[0]).toMatchObject({
			signal: "logs",
			sourceId: "",
			sourceName: null,
			sourceType: "clickhouse",
		});
	});

	it("binds a signal to a source that serves it (project-scoped)", async () => {
		mockFindFirst.mockResolvedValue(row({ signals: "traces,logs,metrics" }));
		mockBindingFindUnique.mockResolvedValue({
			sourceId: "src-old",
			databaseConfigId: null,
			source: { type: "tempo" },
		});
		mockBindingUpsert.mockResolvedValue({
			id: "b1",
			signal: "traces",
			sourceId: "src-1",
			environment: "production",
		});
		const result = await setTelemetrySourceBinding("traces", "src-1");
		expect(result).toMatchObject({
			sourceId: "src-1",
			previousSourceId: "src-old",
			previousSourceType: "tempo",
			nextSourceType: "datadog",
			environment: "production",
		});
		expect(mockBindingFindUnique).toHaveBeenCalledWith({
			where: { projectId_signal_environment: { projectId: "proj-1", signal: "traces", environment: "production" } },
			include: { source: true },
		});
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { id: "src-1", projectId: "proj-1" },
		});
		expect(mockBindingUpsert).toHaveBeenCalledWith({
			where: { projectId_signal_environment: { projectId: "proj-1", signal: "traces", environment: "production" } },
			create: { projectId: "proj-1", signal: "traces", environment: "production", sourceId: "src-1", databaseConfigId: null },
			update: { sourceId: "src-1", databaseConfigId: null },
		});
	});

	it("accepts connector-registry telemetry: prefixed source ids", async () => {
		mockFindFirst.mockResolvedValue(row({ signals: "logs" }));
		mockBindingUpsert.mockResolvedValue({
			id: "b2",
			signal: "logs",
			sourceId: "src-1",
		});
		await setTelemetrySourceBinding("logs", "telemetry:src-1");
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { id: "src-1", projectId: "proj-1" },
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

	it("rejects binding an external source whose environment does not match the requested one", async () => {
		mockFindFirst.mockResolvedValue(
			row({ signals: "traces", environment: "staging" })
		);
		await expect(
			setTelemetrySourceBinding("traces", "src-1", "production")
		).rejects.toThrow(/does not match|environment/i);
		expect(mockBindingUpsert).not.toHaveBeenCalled();
	});

	it("binds a signal to a built-in ClickHouse database config via a builtin: source id", async () => {
		mockDatabaseConfigFindFirst.mockResolvedValue({
			id: "db-9",
			name: "Staging CH",
			projectId: "proj-1",
			environment: "staging",
		});
		mockBindingFindUnique.mockResolvedValue({
			sourceId: null,
			databaseConfigId: "db-old",
			source: null,
		});
		mockBindingUpsert.mockResolvedValue({ id: "b3", signal: "metrics" });
		const result = await setTelemetrySourceBinding(
			"metrics",
			"builtin:db-9",
			"staging"
		);
		expect(result).toMatchObject({
			signal: "metrics",
			sourceId: "builtin:db-9",
			environment: "staging",
			previousSourceId: "builtin:db-old",
			previousSourceType: "clickhouse",
			nextSourceType: "clickhouse",
		});
		expect(mockBindingUpsert).toHaveBeenCalledWith({
			where: {
				projectId_signal_environment: {
					projectId: "proj-1",
					signal: "metrics",
					environment: "staging",
				},
			},
			create: {
				projectId: "proj-1",
				signal: "metrics",
				environment: "staging",
				sourceId: null,
				databaseConfigId: "db-9",
			},
			update: { sourceId: null, databaseConfigId: "db-9" },
		});
	});

	it("rejects a builtin: source id that does not resolve to a project database config", async () => {
		mockDatabaseConfigFindFirst.mockResolvedValue(null);
		await expect(
			setTelemetrySourceBinding("metrics", "builtin:missing-db")
		).rejects.toThrow();
		expect(mockBindingUpsert).not.toHaveBeenCalled();
	});

	it("rejects a builtin: database config whose environment does not match the requested one", async () => {
		mockDatabaseConfigFindFirst.mockResolvedValue({
			id: "db-9",
			name: "Staging CH",
			projectId: "proj-1",
			environment: "staging",
		});
		await expect(
			setTelemetrySourceBinding("metrics", "builtin:db-9", "production")
		).rejects.toThrow(/does not match|environment/i);
		expect(mockBindingUpsert).not.toHaveBeenCalled();
	});

	it("treats a malformed existing binding (neither sourceId nor databaseConfigId) as having no previous source", async () => {
		mockBindingFindFirst.mockResolvedValue({
			sourceId: null,
			databaseConfigId: null,
			source: null,
		});
		mockBindingDeleteMany.mockResolvedValue({ count: 1 });
		await expect(deleteTelemetrySourceBinding("metrics")).resolves.toMatchObject(
			{ previousSourceId: null, previousSourceType: null }
		);
	});

	it("deletes a signal binding (project-scoped)", async () => {
		mockBindingFindFirst.mockResolvedValue({
			sourceId: "src-9",
			databaseConfigId: null,
			source: { type: "tempo" },
		});
		mockBindingDeleteMany.mockResolvedValue({ count: 1 });
		await expect(deleteTelemetrySourceBinding("logs")).resolves.toEqual({
			signal: "logs",
			environment: "production",
			previousSourceId: "src-9",
			previousSourceType: "tempo",
		});
		expect(mockBindingFindFirst).toHaveBeenCalledWith({
			where: { projectId: "proj-1", signal: "logs", environment: "production" },
			include: { source: true },
		});
		expect(mockBindingDeleteMany).toHaveBeenCalledWith({
			where: { projectId: "proj-1", signal: "logs", environment: "production" },
		});
	});
});
