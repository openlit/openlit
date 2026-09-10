const mockDataCollector = jest.fn();
const mockGetVersion = jest.fn();
const mockGetAgent = jest.fn();
const mockLoggerError = jest.fn();

jest.mock("@/lib/platform/common", () => {
	const collector = (...args: unknown[]) => mockDataCollector(...args);
	return {
		dataCollector: collector,
		intelligenceDataCollector: collector,
		OTEL_TRACES_TABLE_NAME: "otel_traces",
	};
});

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

const mockGetTelemetryAdapterForDbConfig = jest.fn();
jest.mock("@/lib/telemetry-source", () => ({
	getTelemetryAdapterForDbConfig: (...args: unknown[]) =>
		mockGetTelemetryAdapterForDbConfig(...args),
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
		mockGetTelemetryAdapterForDbConfig.mockReset();
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

	it("falls through to the ClickHouse probe when the resolved adapter is built-in", async () => {
		mockGetTelemetryAdapterForDbConfig.mockResolvedValue({ isBuiltIn: true });

		await expect(getVersionWindow("agent-1", "v1", "db-1")).resolves.toMatchObject({
			hasAttributeSpans: true,
		});
		expect(mockDataCollector).toHaveBeenCalled();
	});

	it("uses a non-built-in telemetry adapter's listSpans instead of ClickHouse", async () => {
		const listSpans = jest.fn().mockResolvedValue({ rows: [{ id: "span-1" }] });
		mockGetTelemetryAdapterForDbConfig.mockResolvedValue({
			isBuiltIn: false,
			adapter: { listSpans },
		});

		await expect(getVersionWindow("agent-1", "v1", "db-1")).resolves.toMatchObject({
			hasAttributeSpans: true,
		});
		expect(listSpans).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "traces",
				aiSelector: true,
				limit: 1,
			})
		);
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("reports no attribute spans when a non-built-in adapter finds none", async () => {
		mockGetTelemetryAdapterForDbConfig.mockResolvedValue({
			isBuiltIn: false,
			adapter: { listSpans: jest.fn().mockResolvedValue({ rows: [] }) },
		});

		await expect(getVersionWindow("agent-1", "v1", "db-1")).resolves.toMatchObject({
			hasAttributeSpans: false,
		});
		expect(mockDataCollector).not.toHaveBeenCalled();
	});

	it("falls back to a 24h window when the version's first/last seen dates are invalid", async () => {
		mockGetVersion.mockResolvedValueOnce({
			version_hash: "v1",
			first_seen: "not-a-date",
			last_seen: "also-not-a-date",
		});
		const listSpans = jest.fn().mockResolvedValue({ rows: [] });
		mockGetTelemetryAdapterForDbConfig.mockResolvedValue({
			isBuiltIn: false,
			adapter: { listSpans },
		});

		await getVersionWindow("agent-1", "v1", "db-1");

		const call = listSpans.mock.calls[0][0];
		expect(call.timeRange.start).toBeInstanceOf(Date);
		expect(call.timeRange.end).toBeInstanceOf(Date);
	});

	it("falls back to the ClickHouse probe when resolving the telemetry adapter throws", async () => {
		mockGetTelemetryAdapterForDbConfig.mockRejectedValue(new Error("boom"));

		await expect(getVersionWindow("agent-1", "v1", "db-1")).resolves.toMatchObject({
			hasAttributeSpans: true,
		});
		expect(mockDataCollector).toHaveBeenCalled();
	});

	it("falls back to the current time in the ClickHouse probe when dates are unparsable", async () => {
		mockGetVersion.mockResolvedValueOnce({
			version_hash: "v1",
			first_seen: "not-a-date-at-all",
			last_seen: "also-garbage",
		});
		// No dbConfigId -> skips the telemetry-adapter branch and goes straight
		// to the ClickHouse probe, exercising toClickHouseDateTime's NaN fallback.
		await getVersionWindow("agent-1", "v1");

		const call = mockDataCollector.mock.calls[0][0];
		expect(call.query).toMatch(
			/parseDateTimeBestEffort\('\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'\)/
		);
	});

	it("reformats a parsable date-only string that doesn't match the fast-path regex", async () => {
		mockGetVersion.mockResolvedValueOnce({
			version_hash: "v1",
			first_seen: "2026-01-01", // valid Date, but no time component to match the regex
			last_seen: "2026-01-02T00:00:00.000Z",
		});
		await getVersionWindow("agent-1", "v1");

		const call = mockDataCollector.mock.calls[0][0];
		expect(call.query).toContain("2026-01-01 00:00:00");
	});

	it("treats a missing data array from a successful probe as no stamped spans", async () => {
		mockDataCollector.mockResolvedValueOnce({ err: null, data: undefined });

		await expect(getVersionWindow("agent-1", "v1")).resolves.toMatchObject({
			hasAttributeSpans: false,
		});
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
