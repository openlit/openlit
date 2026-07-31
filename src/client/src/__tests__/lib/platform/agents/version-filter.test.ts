const mockDataCollector = jest.fn();
const mockGetVersion = jest.fn();
const mockGetAgent = jest.fn();
const mockLoggerError = jest.fn();

jest.mock("@/lib/platform/common", () => ({
	dataCollector: (...args: unknown[]) => mockDataCollector(...args),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

jest.mock("@/lib/platform/agents/cache", () => ({
	POLICY_VERSIONS: { ttlMs: 1000, staleMs: 2000 },
	swr: jest.fn((_key, _policy, loader) => loader()),
}));

jest.mock("@/lib/platform/agents/snapshot", () => ({
	getVersion: (...args: unknown[]) => mockGetVersion(...args),
}));

jest.mock("@/lib/platform/agents/index", () => {
	const actual = jest.requireActual("@/lib/platform/agents/index") as Record<
		string,
		unknown
	>;
	return {
		...actual,
		getAgent: (...args: unknown[]) => mockGetAgent(...args),
	};
});

jest.mock("@/lib/platform/agents/logger", () => ({
	agentsLogger: {
		error: (...args: unknown[]) => mockLoggerError(...args),
	},
}));

import {
	buildVersionWhereClause,
	getVersionWindow,
} from "@/lib/platform/agents/version-filter";

describe("getVersionWindow", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockGetVersion.mockResolvedValue({
			version_hash: "v1",
			first_seen: "2026-01-01T00:00:00.000Z",
			last_seen: "2026-01-02T00:00:00.000Z",
		});
		mockGetAgent.mockResolvedValue({
			service_name: "api",
			environment: "production",
		});
		mockDataCollector.mockResolvedValue({ err: null, data: [{ stamped: 1 }] });
	});

	it("re-exports the pure version where builder", () => {
		expect(buildVersionWhereClause(null)).toBe("");
	});

	it("returns null when the version is missing", async () => {
		mockGetVersion.mockResolvedValueOnce(null);

		await expect(getVersionWindow("agent-1", "v1", "db-1")).resolves.toBeNull();
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("resolves stamped version windows", async () => {
		await expect(getVersionWindow("agent-1", "v1", "db-1")).resolves.toEqual({
			versionHash: "v1",
			firstSeen: "2026-01-01T00:00:00.000Z",
			lastSeen: "2026-01-02T00:00:00.000Z",
			hasAttributeSpans: true,
		});

		expect(mockGetVersion).toHaveBeenCalledWith("agent-1", "v1", "db-1");
		expect(mockGetAgent).toHaveBeenCalledWith({
			agentKey: "agent-1",
			dbConfigId: "db-1",
		});
		expect(mockDataCollector).toHaveBeenCalledWith(
			{ query: expect.stringContaining("ServiceName = 'api'") },
			"query",
			"db-1"
		);
	});

	it("does not probe traces when agent metadata is missing", async () => {
		mockGetAgent.mockResolvedValueOnce(null);

		await expect(getVersionWindow("agent-1", "v1")).resolves.toMatchObject({
			hasAttributeSpans: false,
		});
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("falls back to unstamped windows when the probe errors", async () => {
		mockDataCollector.mockResolvedValueOnce({
			err: new Error("clickhouse unavailable"),
			data: [],
		});

		await expect(getVersionWindow("agent-1", "v1")).resolves.toMatchObject({
			hasAttributeSpans: false,
		});
		expect(mockLoggerError).toHaveBeenCalledWith(
			"probe_attribute_stamping_failed",
			expect.objectContaining({
				serviceName: "api",
				versionHash: "v1",
			})
		);
	});

	it("uses the default environment predicate for default agents", async () => {
		mockGetAgent.mockResolvedValueOnce({
			service_name: "api",
			environment: "default",
		});

		await getVersionWindow("agent-1", "v1");

		expect(mockDataCollector).toHaveBeenCalledWith(
			{
				query: expect.stringContaining(
					"ResourceAttributes['deployment.environment'] IN ('default', 'local', 'default_environment', '')"
				),
			},
			"query",
			undefined
		);
	});
});
