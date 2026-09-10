const mockResolveSignalSource = jest.fn();

jest.mock("@/lib/telemetry-source", () => ({
	resolveSignalSource: (...args: unknown[]) => mockResolveSignalSource(...args),
}));

import {
	authorizeTelemetrySQLRouting,
	telemetrySignalsReferencedBySQL,
} from "@/lib/platform/chat/telemetry-sql-routing";

describe("Otter telemetry SQL routing", () => {
	beforeEach(() => jest.clearAllMocks());

	it("detects the signal behind each raw OTel table", () => {
		expect(
			telemetrySignalsReferencedBySQL(
				"SELECT * FROM otel_traces JOIN otel_metrics_sum ON 1 = 1"
			)
		).toEqual(["traces", "metrics"]);
	});

	it("blocks ClickHouse trace reads when traces are routed to Tempo", async () => {
		mockResolveSignalSource.mockResolvedValue({
			hasSource: true,
			descriptor: {
				id: "tempo-1",
				name: "Production Tempo",
				type: "tempo",
				isBuiltIn: false,
			},
		});

		const result = await authorizeTelemetrySQLRouting(
			"SELECT * FROM otel_traces LIMIT 10",
			{ environment: "production", databaseConfigId: "clickhouse-1" }
		);

		expect(result.allowed).toBe(false);
		expect(result.error).toContain("traces -> Production Tempo (tempo)");
		expect(mockResolveSignalSource).toHaveBeenCalledWith("traces", {
			environment: "production",
		});
	});

	it("allows a telemetry table only when its signal uses the execution database", async () => {
		mockResolveSignalSource.mockResolvedValue({
			hasSource: true,
			descriptor: {
				id: "builtin:clickhouse-1",
				name: "ClickHouse",
				type: "clickhouse",
				isBuiltIn: true,
				dbConfigId: "clickhouse-1",
			},
		});

		await expect(
			authorizeTelemetrySQLRouting("SELECT * FROM otel_traces LIMIT 10", {
				databaseConfigId: "clickhouse-1",
			})
		).resolves.toEqual({ allowed: true, blockedSignals: [] });
	});

	it("blocks a different ClickHouse database to avoid cross-source reads", async () => {
		mockResolveSignalSource.mockResolvedValue({
			hasSource: true,
			descriptor: {
				id: "builtin:clickhouse-2",
				name: "Other ClickHouse",
				type: "clickhouse",
				isBuiltIn: true,
				dbConfigId: "clickhouse-2",
			},
		});

		const result = await authorizeTelemetrySQLRouting(
			"SELECT * FROM otel_traces LIMIT 10",
			{ databaseConfigId: "clickhouse-1" }
		);
		expect(result.allowed).toBe(false);
	});
});
