const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockBindingFindUnique = jest.fn();
const mockGetDBConfigByUser = jest.fn();
const mockGetDBConfigById = jest.fn();
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
	},
}));

jest.mock("@/lib/db-config", () => ({
	getDBConfigByUser: (...args: unknown[]) => mockGetDBConfigByUser(...args),
	getDBConfigById: (...args: unknown[]) => mockGetDBConfigById(...args),
}));

jest.mock("@/lib/organisation", () => ({
	getCurrentOrganisation: (...args: unknown[]) =>
		mockGetCurrentOrganisation(...args),
	getCurrentProjectForOrganisation: (...args: unknown[]) =>
		mockGetCurrentProjectForOrganisation(...args),
}));

jest.mock("@/lib/platform/datasource/http/secret", () => ({
	resolveSourceSecret: jest.fn(),
	redactableSecretValues: () => [],
}));

jest.mock("@/utils/log", () => ({
	consoleLog: jest.fn(),
}));

import {
	builtInDescriptor,
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
});

describe("parseSignals", () => {
	it("defaults to all signals when empty", () => {
		expect(parseSignals(undefined)).toEqual(["traces", "logs", "metrics"]);
		expect(parseSignals("")).toEqual(["traces", "logs", "metrics"]);
	});

	it("parses and trims valid signals", () => {
		expect(parseSignals("traces, metrics")).toEqual(["traces", "metrics"]);
	});

	it("drops invalid signals and falls back if none valid", () => {
		expect(parseSignals("bogus")).toEqual(["traces", "logs", "metrics"]);
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
		expect(d.signals).toEqual(["traces", "logs", "metrics"]);
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

describe("resolveTelemetrySourceDescriptor precedence", () => {
	it("1. resolves an explicit sourceId override", async () => {
		mockFindUnique.mockResolvedValue({
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
		expect(mockFindFirst).not.toHaveBeenCalled();
	});

	it("falls through to project default when sourceId is missing", async () => {
		mockFindUnique.mockResolvedValue(null);
		mockGetCurrentOrganisation.mockResolvedValue({ id: "org-1" });
		mockGetCurrentProjectForOrganisation.mockResolvedValue({ id: "proj-1" });
		mockFindFirst.mockResolvedValue({
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

	it("ignores a binding that does not serve the signal and picks a capable source", async () => {
		mockBindingFindUnique.mockResolvedValue({
			source: srcRow({ id: "prom-1", type: "prometheus", signals: "metrics" }),
		});
		mockFindMany.mockResolvedValue([
			srcRow({ id: "prom-1", type: "prometheus", signals: "metrics" }),
			srcRow({ id: "tempo-1", type: "tempo", signals: "traces" }),
		]);
		const res = await resolveSignalSource("traces");
		expect(res.via).toBe("capability");
		expect(res.descriptor.id).toBe("tempo-1");
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
});

describe("sourceSupportsNativeSql", () => {
	it("is true only for the built-in ClickHouse source", () => {
		expect(sourceSupportsNativeSql(builtInDescriptor(dbConfig))).toBe(true);
		expect(
			sourceSupportsNativeSql({
				type: "datadog",
				id: "src-1",
				isBuiltIn: false,
				settings: {},
				signals: ["traces"],
				name: "DD",
			})
		).toBe(false);
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

		const res = await isNativeSqlChatAvailable();
		expect(res).toMatchObject({
			available: false,
			sourceType: "datadog",
			sourceName: "Prod Datadog",
		});
	});
});
