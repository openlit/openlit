const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockBindingFindUnique = jest.fn();
const mockDatabaseConfigFindFirst = jest.fn();
const mockGetDBConfigByUser = jest.fn();
const mockGetDBConfigById = jest.fn();
const mockGetDBConfigByIdInternal = jest.fn();
const mockGetCurrentOrganisation = jest.fn();
const mockGetCurrentProjectForOrganisation = jest.fn();

jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: {
		telemetrySource: {
			findUnique: (...args: unknown[]) => mockFindUnique(...args),
			findFirst: (...args: unknown[]) => mockFindFirst(...args),
			findMany: (...args: unknown[]) => mockFindMany(...args),
		},
		telemetrySourceBinding: {
			findUnique: (...args: unknown[]) => mockBindingFindUnique(...args),
		},
		databaseConfig: {
			findFirst: (...args: unknown[]) => mockDatabaseConfigFindFirst(...args),
		},
	},
}));

jest.mock("@/lib/db-config", () => ({
	getDBConfigByUser: (...args: unknown[]) => mockGetDBConfigByUser(...args),
	getDBConfigById: (...args: unknown[]) => mockGetDBConfigById(...args),
	getDBConfigByIdInternal: (...args: unknown[]) =>
		mockGetDBConfigByIdInternal(...args),
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: (...args: unknown[]) =>
		mockGetCurrentOrganisation(...args),
	getCurrentProjectForOrganisation: (...args: unknown[]) =>
		mockGetCurrentProjectForOrganisation(...args),
}));

jest.mock("@/lib/platform/connectors/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(),
	redactableSecretValues: () => [],
}));

jest.mock("@/utils/log", () => ({
	consoleLog: jest.fn(),
}));

let headerValues: Record<string, string | null> = {};
jest.mock("next/headers", () => ({
	headers: jest.fn(async () => ({
		get: (key: string) => headerValues[key] ?? null,
	})),
}));

// Wrap the real adapter registry so most tests exercise genuine adapter
// construction (as before), while a couple of defensive-fallback tests can
// force a single `createAdapter` call to miss without disabling the registry.
jest.mock("@/lib/platform/connectors/datasource/registry", () => {
	const actual = jest.requireActual(
		"@/lib/platform/connectors/datasource/registry"
	);
	return { ...actual, createAdapter: jest.fn(actual.createAdapter) };
});

import { OPENLIT_CONTEXT_HEADERS, MIDDLEWARE_DATABASE_CONFIG_HEADER } from "@/constants/openlit-context";
import { createAdapter as mockedCreateAdapter } from "@/lib/platform/connectors/datasource/registry";
import { headers as mockedHeaders } from "next/headers";
import {
	builtInDescriptor,
	getTelemetryAdapter,
	getTelemetryAdapterForDbConfig,
	isSignalServedByBuiltInClickHouse,
	isNativeSqlChatAvailable,
	parseSettings,
	parseSignals,
	resolveSignalSource,
	resolveTelemetrySourceDescriptor,
	sourceSupportsNativeSql,
	toDescriptor,
} from "@/lib/telemetry-source";

const srcRow = (over: Record<string, unknown> = {}) => ({
	id: "src-1",
	projectId: "proj-1",
	name: "Source",
	type: "clickhouse",
	signals: "traces,logs,metrics",
	settings: "{}",
	secretRef: null,
	isDefault: false,
	createdAt: new Date(),
	updatedAt: new Date(),
	createdByUserId: null,
	...over,
});

const dbConfig = {
	id: "db-1",
	name: "Primary CH",
	projectId: "proj-1",
} as any;

beforeEach(() => {
	jest.clearAllMocks();
	headerValues = {};
	// These mocks return real domain data (DatabaseConfig/TelemetrySource rows,
	// org/project ids) that several tests configure with a sticky
	// `mockResolvedValue`. `clearAllMocks` only clears call history, not that
	// configured value, so explicitly reset them here to avoid one test's
	// setup leaking into the next test's "no data configured" expectations.
	mockFindUnique.mockReset();
	mockFindFirst.mockReset();
	mockFindMany.mockReset();
	mockBindingFindUnique.mockReset();
	mockDatabaseConfigFindFirst.mockReset();
	mockGetDBConfigByUser.mockReset();
	mockGetDBConfigById.mockReset();
	mockGetDBConfigByIdInternal.mockReset();
	mockGetCurrentOrganisation.mockReset();
	mockGetCurrentProjectForOrganisation.mockReset();
});

describe("parseSignals", () => {
	it("defaults to all signals when empty", () => {
		expect(parseSignals(undefined)).toEqual(["traces", "logs", "metrics", "intelligence"]);
		expect(parseSignals("")).toEqual(["traces", "logs", "metrics", "intelligence"]);
	});

	it("parses and trims valid signals", () => {
		expect(parseSignals("traces, metrics")).toEqual(["traces", "metrics"]);
	});

	it("drops invalid signals and falls back if none valid", () => {
		expect(parseSignals("bogus")).toEqual(["traces", "logs", "metrics", "intelligence"]);
		expect(parseSignals("logs,bogus")).toEqual(["logs"]);
	});
});

describe("parseSettings", () => {
	it("returns {} for empty or invalid JSON", () => {
		expect(parseSettings(undefined)).toEqual({});
		expect(parseSettings("not-json")).toEqual({});
		expect(parseSettings("123")).toEqual({});
	});

	it("parses JSON objects", () => {
		expect(parseSettings('{"site":"datadoghq.eu"}')).toEqual({
			site: "datadoghq.eu",
		});
	});
});

describe("builtInDescriptor", () => {
	it("builds a clickhouse built-in descriptor from a DatabaseConfig", () => {
		const d = builtInDescriptor(dbConfig);
		expect(d).toMatchObject({
			type: "clickhouse",
			id: "builtin:db-1",
			isBuiltIn: true,
			dbConfigId: "db-1",
			projectId: "proj-1",
			name: "Primary CH",
		});
		expect(d.signals).toEqual(["traces", "logs", "metrics", "intelligence"]);
	});
});

describe("toDescriptor", () => {
	it("maps a TelemetrySource row to a descriptor", () => {
		const row = {
			id: "src-1",
			projectId: "proj-1",
			name: "Prod Datadog",
			type: "datadog",
			signals: "traces,logs",
			settings: '{"site":"datadoghq.com"}',
			secretRef: "vault-1",
			isDefault: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			createdByUserId: "u1",
		} as any;
		expect(toDescriptor(row)).toEqual({
			type: "datadog",
			id: "src-1",
			isBuiltIn: false,
			settings: { site: "datadoghq.com" },
			secretRef: "vault-1",
			signals: ["traces", "logs"],
			projectId: "proj-1",
			name: "Prod Datadog",
		});
	});
});

describe("request-context header resolution (getCurrentProjectId)", () => {
	it("uses the x-openlit-project-id header directly, skipping org lookup", async () => {
		headerValues[OPENLIT_CONTEXT_HEADERS.projectId] = "proj-header";
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		await resolveTelemetrySourceDescriptor();

		expect(mockGetCurrentOrganisation).not.toHaveBeenCalled();
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { projectId: "proj-header", isDefault: true },
			orderBy: { createdAt: "asc" },
		});
	});

	it("resolves the project via the middleware database-config header when no project header is present", async () => {
		headerValues[MIDDLEWARE_DATABASE_CONFIG_HEADER] = "db-header";
		mockGetDBConfigByIdInternal.mockResolvedValue({
			id: "db-header",
			projectId: "proj-fromheader",
		});
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		await resolveTelemetrySourceDescriptor();

		expect(mockGetDBConfigByIdInternal).toHaveBeenCalledWith({ id: "db-header" });
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { projectId: "proj-fromheader", isDefault: true },
			orderBy: { createdAt: "asc" },
		});
	});

	it("falls through to org lookup when the header database config has no projectId", async () => {
		headerValues[MIDDLEWARE_DATABASE_CONFIG_HEADER] = "db-header";
		mockGetDBConfigByIdInternal.mockResolvedValue({ id: "db-header" });
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		await resolveTelemetrySourceDescriptor();

		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { projectId: "proj-1", isDefault: true },
			orderBy: { createdAt: "asc" },
		});
	});

	it("treats a request-context header read failure (e.g. outside a request scope) as no headers", async () => {
		(mockedHeaders as jest.Mock).mockRejectedValueOnce(new Error("no request context"));
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		const d = await resolveTelemetrySourceDescriptor();

		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { projectId: "proj-1", isDefault: true },
			orderBy: { createdAt: "asc" },
		});
		expect(d).toMatchObject({ type: "clickhouse", isBuiltIn: true });
	});

	it("returns a null project id when the organisation lookup throws", async () => {
		mockGetCurrentOrganisation.mockRejectedValue(new Error("org lookup down"));
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		const d = await resolveTelemetrySourceDescriptor();

		// No project -> step 2 (project default) is skipped entirely, falling
		// straight through to the built-in ClickHouse source.
		expect(mockFindFirst).not.toHaveBeenCalled();
		expect(d).toMatchObject({ type: "clickhouse", isBuiltIn: true });
	});
});

describe("resolveTelemetrySourceDescriptor precedence", () => {
	it("1. resolves an explicit sourceId override within the current project", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		// First findFirst is the project-scoped sourceId lookup; no default needed.
		mockFindFirst.mockResolvedValueOnce({
			id: "src-1",
			projectId: "proj-1",
			name: "Prod Tempo",
			type: "tempo",
			signals: "traces",
			settings: "{}",
			secretRef: null,
			isDefault: false,
			createdAt: new Date(),
			updatedAt: new Date(),
			createdByUserId: null,
		});

		const d = await resolveTelemetrySourceDescriptor({ sourceId: "src-1" });
		expect(d.type).toBe("tempo");
		expect(d.id).toBe("src-1");
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { id: "src-1", projectId: "proj-1", environment: "production" },
		});
		expect(mockFindUnique).not.toHaveBeenCalled();
	});

	it("denies a sourceId that belongs to another project (IDOR)", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		// Project-scoped lookup misses (source lives in proj-2).
		mockFindFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				id: "src-default",
				projectId: "proj-1",
				name: "Default NR",
				type: "newrelic",
				signals: "traces,logs,metrics",
				settings: "{}",
				secretRef: "vault-2",
				isDefault: true,
				createdAt: new Date(),
				updatedAt: new Date(),
				createdByUserId: null,
			});

		const d = await resolveTelemetrySourceDescriptor({
			sourceId: "foreign-src",
		});
		expect(d.id).toBe("src-default");
		expect(d.type).toBe("newrelic");
		expect(mockFindFirst).toHaveBeenNthCalledWith(1, {
			where: { id: "foreign-src", projectId: "proj-1", environment: "production" },
		});
	});

	it("falls through to project default when sourceId is missing", async () => {
		mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
			id: "src-default",
			projectId: "proj-1",
			name: "Default NR",
			type: "newrelic",
			signals: "traces,logs,metrics",
			settings: "{}",
			secretRef: "vault-2",
			isDefault: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			createdByUserId: null,
		});
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });

		const d = await resolveTelemetrySourceDescriptor({ sourceId: "nope" });
		expect(d.type).toBe("newrelic");
		expect(d.id).toBe("src-default");
	});

	it("2. resolves the current project's default TelemetrySource", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue({
			id: "src-default",
			projectId: "proj-1",
			name: "Default DD",
			type: "datadog",
			signals: "traces,logs,metrics",
			settings: "{}",
			secretRef: "vault-2",
			isDefault: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			createdByUserId: null,
		});

		const d = await resolveTelemetrySourceDescriptor();
		expect(d.type).toBe("datadog");
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { projectId: "proj-1", isDefault: true },
			orderBy: { createdAt: "asc" },
		});
	});

	it("3. falls back to the built-in ClickHouse source (current db config)", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		const d = await resolveTelemetrySourceDescriptor();
		expect(d).toMatchObject({
			type: "clickhouse",
			id: "builtin:db-1",
			isBuiltIn: true,
		});
		expect(mockGetDBConfigByUser).toHaveBeenCalledWith(true);
	});

	it("resolves the built-in source by explicit dbConfigId", async () => {
		mockGetCurrentOrganisation.mockResolvedValue(null);
		mockGetDBConfigById.mockResolvedValue({
			id: "db-2",
			name: "Other CH",
			projectId: null,
		});

		const d = await resolveTelemetrySourceDescriptor({ dbConfigId: "db-2" });
		expect(d).toMatchObject({
			type: "clickhouse",
			id: "builtin:db-2",
			dbConfigId: "db-2",
		});
	});

	it("returns a safe placeholder when no ClickHouse is configured", async () => {
		mockGetCurrentOrganisation.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(undefined);

		const d = await resolveTelemetrySourceDescriptor();
		expect(d).toMatchObject({
			type: "clickhouse",
			id: "builtin:none",
			isBuiltIn: true,
		});
	});

	it("resolves a builtin: sourceId override for the non-signal-aware path", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockDatabaseConfigFindFirst.mockResolvedValue({
			id: "db-9",
			name: "Staging CH",
			projectId: "proj-1",
		});

		const d = await resolveTelemetrySourceDescriptor({ sourceId: "builtin:db-9" });

		expect(d).toMatchObject({ id: "builtin:db-9", type: "clickhouse", dbConfigId: "db-9" });
		expect(mockDatabaseConfigFindFirst).toHaveBeenCalledWith({
			where: { id: "db-9", projectId: "proj-1" },
		});
	});

	it("uses an explicit projectId option instead of resolving the current project", async () => {
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		await resolveTelemetrySourceDescriptor({ projectId: "proj-explicit" });

		expect(mockGetCurrentOrganisation).not.toHaveBeenCalled();
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { projectId: "proj-explicit", isDefault: true },
			orderBy: { createdAt: "asc" },
		});
	});
});

describe("resolveSignalSource (signal-aware routing)", () => {
	beforeEach(() => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
	});

	it("uses the per-signal binding when the bound source serves the signal", async () => {
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		});
		const res = await resolveSignalSource("traces");
		expect(res.via).toBe("binding");
		expect(res.descriptor.id).toBe("tempo-1");
		expect(res.servesSignal).toBe(true);
	});

	it("keeps the active vault DatabaseConfig on an environment-routed external source", async () => {
		mockGetDBConfigByUser.mockResolvedValueOnce({
			...dbConfig,
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		});

		const res = await resolveSignalSource("traces", {
			environment: "production",
		});

		expect(res.descriptor).toMatchObject({
			id: "tempo-1",
			dbConfigId: "db-1",
		});
		expect(mockGetDBConfigByUser).toHaveBeenCalledWith(true);
	});

	it("ignores a binding that does not serve the signal and picks a capable source", async () => {
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "prom-1", type: "prometheus", signals: "metrics" }),
		});
		mockFindMany.mockResolvedValue([
			srcRow({ id: "prom-1", type: "prometheus", signals: "metrics" }),
			srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		]);
		const res = await resolveSignalSource("traces");
		expect(res.via).toBe("none");
	});

	it("never routes a signal to a source that lacks it; falls back to built-in", async () => {
		mockBindingFindUnique.mockResolvedValue(null);
		mockFindMany.mockResolvedValue([
			srcRow({ id: "prom-1", type: "prometheus", signals: "metrics" }),
		]);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);
		const res = await resolveSignalSource("traces");
		expect(res.via).toBe("builtin");
		expect(res.descriptor.type).toBe("clickhouse");
		expect(res.servesSignal).toBe(true);
	});

	it("returns a typed no-source state when nothing serves the signal", async () => {
		mockBindingFindUnique.mockResolvedValue(null);
		mockFindMany.mockResolvedValue([]);
		mockGetDBConfigByUser.mockResolvedValue(undefined);
		const res = await resolveSignalSource("traces");
		expect(res.via).toBe("none");
		expect(res.hasSource).toBe(false);
		expect(res.servesSignal).toBe(false);
	});

	it("routes through resolveTelemetrySourceDescriptor when signal is set", async () => {
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "loki-1", type: "loki", signals: "logs" }),
		});
		const d = await resolveTelemetrySourceDescriptor({ signal: "logs" });
		expect(d.id).toBe("loki-1");
	});

	it("denies a signal override sourceId from another project", async () => {
		mockFindFirst.mockResolvedValue(null);
		mockBindingFindUnique.mockResolvedValue(null);
		mockFindMany.mockResolvedValue([]);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		const res = await resolveSignalSource("traces", {
			sourceId: "foreign-src",
		});
		expect(res.via).toBe("builtin");
		expect(res.descriptor.type).toBe("clickhouse");
		expect(mockFindFirst).toHaveBeenCalledWith({
			where: { id: "foreign-src", projectId: "proj-1", environment: "production" },
		});
		expect(mockFindUnique).not.toHaveBeenCalled();
	});

	it("honors builtin:dbConfigId overrides for signal widgets", async () => {
		mockDatabaseConfigFindFirst.mockResolvedValue({
			id: "db-9",
			name: "Staging CH",
			projectId: "proj-1",
			environment: "staging",
		});

		const res = await resolveSignalSource("metrics", {
			sourceId: "builtin:db-9",
			environment: "staging",
		});

		expect(res.via).toBe("override");
		expect(res.descriptor).toMatchObject({
			id: "builtin:db-9",
			type: "clickhouse",
			dbConfigId: "db-9",
			name: "Staging CH",
		});
		expect(mockDatabaseConfigFindFirst).toHaveBeenCalledWith({
			where: {
				id: "db-9",
				projectId: "proj-1",
				environment: "staging",
			},
		});
	});

	it("falls through to binding/built-in resolution when a builtin: sourceId is not found in the project", async () => {
		mockDatabaseConfigFindFirst.mockResolvedValue(null);
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		});

		const res = await resolveSignalSource("traces", {
			sourceId: "builtin:missing-db",
		});

		expect(res.via).toBe("binding");
		expect(res.descriptor.id).toBe("tempo-1");
	});

	it("resolves an explicit external sourceId override that serves the requested signal", async () => {
		mockFindFirst.mockResolvedValue(
			srcRow({ id: "tempo-1", type: "tempo", signals: "traces" })
		);

		const res = await resolveSignalSource("traces", { sourceId: "tempo-1" });

		expect(res.via).toBe("override");
		expect(res.hasSource).toBe(true);
		expect(res.servesSignal).toBe(true);
		expect(res.descriptor.id).toBe("tempo-1");
	});

	it("resolves an explicit external sourceId override that does NOT serve the requested signal", async () => {
		mockFindFirst.mockResolvedValue(
			srcRow({ id: "prom-1", type: "prometheus", signals: "metrics" })
		);

		const res = await resolveSignalSource("traces", { sourceId: "prom-1" });

		expect(res.via).toBe("override");
		expect(res.hasSource).toBe(true);
		expect(res.servesSignal).toBe(false);
		expect(res.descriptor.id).toBe("prom-1");
	});

	it("falls back to 'production' when an invalid environment string is supplied", async () => {
		mockBindingFindUnique.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		const res = await resolveSignalSource("traces", { environment: "Not Valid!!" });

		expect(mockBindingFindUnique).toHaveBeenCalledWith({
			where: {
				projectId_signal_environment: {
					projectId: "proj-1",
					signal: "traces",
					environment: "production",
				},
			},
			include: { source: true, databaseConfig: true },
		});
		// An explicitly requested (if invalid) environment still fails closed
		// when nothing is routed for it, rather than silently using a default.
		expect(res.via).toBe("none");
	});

	it("scopes resolveActiveCredentialDatabase to null when an explicit projectId is given without a dbConfigId", async () => {
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		});
		// If resolveActiveCredentialDatabase fell through to the user-DB lookup
		// instead of short-circuiting on the explicit projectId, this value
		// would leak into the resolved descriptor's dbConfigId.
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		const res = await resolveSignalSource("traces", { projectId: "proj-1" });

		expect(mockGetDBConfigByUser).not.toHaveBeenCalled();
		expect(res.descriptor.dbConfigId).toBeUndefined();
	});

	it("resolves the active vault database from the middleware header when no dbConfigId/projectId override is given", async () => {
		headerValues[MIDDLEWARE_DATABASE_CONFIG_HEADER] = "db-header";
		mockGetDBConfigByIdInternal.mockResolvedValue({
			...dbConfig,
			id: "db-header",
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		});

		const res = await resolveSignalSource("traces");

		expect(mockGetDBConfigByIdInternal).toHaveBeenCalledWith({ id: "db-header" });
		expect(res.descriptor).toMatchObject({ id: "tempo-1", dbConfigId: "db-header" });
	});

	it("treats a failed active-database lookup as no active database instead of throwing", async () => {
		// Only the first getDBConfigByUser call (inside
		// resolveActiveCredentialDatabase) should be affected by the failure;
		// the built-in fallback's own lookup resolves normally afterward.
		mockGetDBConfigByUser
			.mockRejectedValueOnce(new Error("db down"))
			.mockResolvedValueOnce(undefined);
		mockBindingFindUnique.mockResolvedValue(null);

		const res = await resolveSignalSource("traces");

		expect(res.hasSource).toBe(false);
		expect(res.via).toBe("none");
	});
});

describe("getTelemetryAdapter fail-closed", () => {
	it("throws when an external source type has no registered adapter", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue({
			id: "src-unknown",
			projectId: "proj-1",
			name: "Unknown Vendor",
			type: "not-a-real-adapter-type",
			signals: "traces",
			settings: "{}",
			secretRef: null,
			isDefault: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			createdByUserId: null,
		});

		await expect(getTelemetryAdapter()).rejects.toThrow(
			/No adapter is registered/
		);
	});

	it("resolves via resolveSignalSource when called with a signal and no descriptor", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		});

		const adapter = await getTelemetryAdapter({ signal: "traces" });
		expect(adapter).toBeDefined();
	});

	it("throws the typed no-source error when the requested signal has no source", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockBindingFindUnique.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(undefined);

		await expect(getTelemetryAdapter({ signal: "traces" })).rejects.toThrow(
			/No connector is configured/
		);
	});

	it("falls back to a fresh built-in ClickHouse adapter when the resolved adapter transiently fails to construct", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);
		(mockedCreateAdapter as jest.Mock).mockReturnValueOnce(undefined);

		const adapter = await getTelemetryAdapter();
		expect(adapter).toBeDefined();
		expect(mockedCreateAdapter).toHaveBeenCalledTimes(2);
	});

	it("throws when even the built-in ClickHouse fallback factory is unavailable", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);
		(mockedCreateAdapter as jest.Mock)
			.mockReturnValueOnce(undefined)
			.mockReturnValueOnce(undefined);

		await expect(getTelemetryAdapter()).rejects.toThrow(
			/built-in ClickHouse factory missing/
		);
	});
});

describe("getTelemetryAdapterForDbConfig", () => {
	it("binds the materializer DatabaseConfig to an external source for vault access", async () => {
		mockGetDBConfigByIdInternal.mockResolvedValue({
			...dbConfig,
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({
				id: "tempo-1",
				type: "tempo",
				signals: "traces",
				secretRef: "vault-tempo",
				environment: "production",
			}),
		});

		const result = await getTelemetryAdapterForDbConfig("db-1", "traces");

		expect(result.descriptor).toMatchObject({
			id: "tempo-1",
			type: "tempo",
			projectId: "proj-1",
			secretRef: "vault-tempo",
			dbConfigId: "db-1",
		});
		expect(result.isBuiltIn).toBe(false);
		expect(mockGetDBConfigByIdInternal).toHaveBeenCalledWith({ id: "db-1" });
		expect(mockGetDBConfigById).not.toHaveBeenCalled();
	});

	it("resolves without a user session so cron materializer ticks can run", async () => {
		mockGetDBConfigById.mockRejectedValue(new Error("Unauthorized user!"));
		mockGetDBConfigByIdInternal.mockResolvedValue({
			...dbConfig,
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({
				id: "jaeger-1",
				type: "jaeger",
				signals: "traces",
				secretRef: "vault-jaeger",
				environment: "production",
			}),
		});

		await expect(
			getTelemetryAdapterForDbConfig("db-1", "traces")
		).resolves.toMatchObject({
			isBuiltIn: false,
			descriptor: { id: "jaeger-1", type: "jaeger", dbConfigId: "db-1" },
		});
		expect(mockGetDBConfigById).not.toHaveBeenCalled();
	});

	it("throws the typed no-source error when the DatabaseConfig's environment has no routed connector", async () => {
		mockGetDBConfigByIdInternal.mockResolvedValue({
			...dbConfig,
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue(null);

		await expect(
			getTelemetryAdapterForDbConfig("db-1", "traces")
		).rejects.toThrow(/No connector is configured/);
	});

	it("resolves the isBuiltIn descriptor unchanged (no dbConfigId re-attachment) when the binding routes to the built-in store", async () => {
		mockGetDBConfigByIdInternal.mockResolvedValue({
			...dbConfig,
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue({ databaseConfig: dbConfig });

		const result = await getTelemetryAdapterForDbConfig("db-1", "traces");

		expect(result.isBuiltIn).toBe(true);
		expect(result.descriptor).toMatchObject({ id: "builtin:db-1", dbConfigId: "db-1" });
	});

	it("throws ADAPTER_UNAVAILABLE when the routed external source type has no registered factory", async () => {
		mockGetDBConfigByIdInternal.mockResolvedValue({
			...dbConfig,
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "mystery-1", type: "unknownvendor", signals: "traces" }),
		});

		await expect(
			getTelemetryAdapterForDbConfig("db-1", "traces")
		).rejects.toThrow(/No adapter is registered/);
	});

	it("falls back to a fresh built-in ClickHouse adapter when the routed built-in adapter transiently fails to construct", async () => {
		mockGetDBConfigByIdInternal.mockResolvedValue({
			...dbConfig,
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue({ databaseConfig: dbConfig });
		(mockedCreateAdapter as jest.Mock).mockReturnValueOnce(undefined);

		const result = await getTelemetryAdapterForDbConfig("db-1", "traces");

		expect(result.isBuiltIn).toBe(true);
		expect(result.descriptor).toMatchObject({ id: "builtin:db-1" });
		expect(mockedCreateAdapter).toHaveBeenCalledTimes(2);
	});

	it("throws when even the built-in ClickHouse fallback factory is unavailable", async () => {
		mockGetDBConfigByIdInternal.mockResolvedValue({
			...dbConfig,
			environment: "production",
		});
		mockBindingFindUnique.mockResolvedValue({ databaseConfig: dbConfig });
		(mockedCreateAdapter as jest.Mock)
			.mockReturnValueOnce(undefined)
			.mockReturnValueOnce(undefined);

		await expect(
			getTelemetryAdapterForDbConfig("db-1", "traces")
		).rejects.toThrow(/built-in ClickHouse factory missing/);
	});

	it("re-resolves the built-in descriptor by id when the DatabaseConfig row itself could not be loaded", async () => {
		// `getDBConfigByIdInternal` (used for the outer DatabaseConfig lookup)
		// fails, but the signal still routes to a real built-in via a
		// different lookup (`getDBConfigById`) inside resolveBuiltInDescriptor.
		mockGetDBConfigByIdInternal.mockResolvedValue(null);
		mockGetDBConfigById.mockResolvedValue({
			id: "db-1",
			name: "Real CH",
			projectId: "proj-1",
		});
		(mockedCreateAdapter as jest.Mock).mockReturnValueOnce(undefined);

		const result = await getTelemetryAdapterForDbConfig("db-1", "traces");

		expect(result.isBuiltIn).toBe(true);
		expect(result.descriptor).toMatchObject({ id: "builtin:db-1", name: "Real CH" });
		expect(mockGetDBConfigById).toHaveBeenCalledWith({ id: "db-1" });
	});
});

describe("isSignalServedByBuiltInClickHouse", () => {
	it("returns false for the built-in-shaped no-source placeholder", async () => {
		mockGetCurrentOrganisation.mockResolvedValueOnce({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValueOnce({ id: "proj-1" });
		mockGetDBConfigByUser.mockResolvedValueOnce(undefined);
		mockBindingFindUnique.mockResolvedValueOnce(null);

		await expect(
			isSignalServedByBuiltInClickHouse("logs", { environment: "production" })
		).resolves.toBe(false);
	});

	it("returns false when the signal is routed to Tempo", async () => {
		mockGetCurrentOrganisation.mockResolvedValueOnce({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValueOnce({ id: "proj-1" });
		mockGetDBConfigByUser.mockResolvedValueOnce(dbConfig);
		mockBindingFindUnique.mockResolvedValueOnce({
			source: srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		});

		await expect(isSignalServedByBuiltInClickHouse("traces")).resolves.toBe(false);
	});

	it("returns true only for a real routed built-in ClickHouse", async () => {
		mockGetCurrentOrganisation.mockResolvedValueOnce({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValueOnce({ id: "proj-1" });
		mockGetDBConfigByUser.mockResolvedValueOnce(dbConfig);
		mockBindingFindUnique.mockResolvedValueOnce({ databaseConfig: dbConfig });

		await expect(isSignalServedByBuiltInClickHouse("logs")).resolves.toBe(true);
	});
});


describe("isNativeSqlChatAvailable", () => {
	it("is available on the built-in ClickHouse source", async () => {
		mockFindUnique.mockResolvedValue(null);
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue(null);
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		const res = await isNativeSqlChatAvailable();
		expect(res).toMatchObject({ available: true, sourceType: "clickhouse" });
	});

	it("is unavailable when the project default is an external source", async () => {
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue({
			id: "src-default",
			projectId: "proj-1",
			name: "Prod Datadog",
			type: "datadog",
			signals: "traces,logs,metrics",
			settings: "{}",
			secretRef: "vault-2",
			isDefault: true,
			createdAt: new Date(),
			updatedAt: new Date(),
			createdByUserId: null,
		});
		// A real, reachable built-in ClickHouse must be routed for the
		// "builtin" via-path check to even consider the legacy default-source
		// fallback below.
		mockGetDBConfigByUser.mockResolvedValue(dbConfig);

		const res = await isNativeSqlChatAvailable();
		expect(res).toMatchObject({
			available: false,
			sourceType: "datadog",
			sourceName: "Prod Datadog",
		});
	});
});
