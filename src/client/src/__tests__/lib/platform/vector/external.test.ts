const mockResolveDescriptor = jest.fn();
const mockGetAdapter = jest.fn();

jest.mock("@/lib/telemetry-source", () => ({
	resolveTelemetrySourceDescriptor: (...a: unknown[]) =>
		mockResolveDescriptor(...a),
	getTelemetryAdapter: (...a: unknown[]) => mockGetAdapter(...a),
}));

import {
	externalResultGenerationByOperation,
	externalResultGenerationBySystem,
	externalResultGenerationByEnvironment,
	externalResultGenerationByApplication,
} from "@/lib/platform/vector/external";

const tempo = {
	type: "tempo",
	id: "src-tempo",
	isBuiltIn: false,
	settings: {},
	signals: ["traces"],
	name: "Tempo",
	dbConfigId: "db-1",
};

const builtin = {
	type: "clickhouse",
	id: "builtin:db-1",
	isBuiltIn: true,
	settings: {},
	signals: ["traces"],
	name: "CH",
	dbConfigId: "db-1",
};

const params = {
	timeLimit: {
		start: new Date("2026-07-01T00:00:00.000Z"),
		end: new Date("2026-07-01T01:00:00.000Z"),
		type: "CUSTOM",
	},
	limit: 10,
	offset: 0,
	selectedConfig: {},
};

function adapterWith(aggregateSpans: jest.Mock) {
	return { capabilities: () => ({ serverAggregation: true }), aggregateSpans };
}

beforeEach(() => {
	jest.clearAllMocks();
	mockResolveDescriptor.mockResolvedValue(tempo);
});

describe("built-in ClickHouse routing", () => {
	it("returns null for every export on the built-in source", async () => {
		mockResolveDescriptor.mockResolvedValue(builtin);
		expect(await externalResultGenerationByOperation(params)).toBeNull();
		expect(await externalResultGenerationBySystem(params)).toBeNull();
		expect(await externalResultGenerationByEnvironment(params)).toBeNull();
		expect(await externalResultGenerationByApplication(params)).toBeNull();
		expect(mockGetAdapter).not.toHaveBeenCalled();
	});

	it("returns null when the resolved type is clickhouse even if not flagged built-in", async () => {
		mockResolveDescriptor.mockResolvedValue({ ...tempo, isBuiltIn: false, type: "clickhouse" });
		expect(await externalResultGenerationByOperation(params)).toBeNull();
	});

	it("resolves the traces adapter and scopes the query to vectordb operations", async () => {
		const aggregateSpans = jest.fn().mockResolvedValue({ rows: [] });
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		await externalResultGenerationByOperation(params);

		expect(mockGetAdapter).toHaveBeenCalledWith({ signal: "traces", environment: undefined });
		const query = aggregateSpans.mock.calls[0][0];
		expect(query.filters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "gen_ai.operation.name",
					op: "eq",
					value: "vectordb",
				}),
			])
		);
		expect(query.groupBy).toEqual(["db.operation"]);
	});
});

describe("externalResultGenerationByOperation", () => {
	it("groups by db.operation", async () => {
		const aggregateSpans = jest.fn().mockResolvedValue({
			rows: [{ group_value: "insert", count: 3 }],
		});
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByOperation(params);
		expect(res).toEqual({ err: null, data: [{ operation: "insert", count: 3 }] });
	});

	it("falls back to the raw field and zero count when absent", async () => {
		const aggregateSpans = jest.fn().mockResolvedValue({ rows: [{ "db.operation": "query" }] });
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByOperation(params);
		expect(res).toEqual({ err: null, data: [{ operation: "query", count: 0 }] });
	});

	it("defaults to an empty label when nothing is present", async () => {
		const aggregateSpans = jest.fn().mockResolvedValue({ rows: [{}] });
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByOperation(params);
		expect(res).toEqual({ err: null, data: [{ operation: "", count: 0 }] });
	});

	it("returns a stringified error when the adapter throws a non-Error value", async () => {
		const aggregateSpans = jest.fn().mockRejectedValue("boom");
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByOperation(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});

	it("returns the Error message when the adapter throws an Error", async () => {
		const aggregateSpans = jest.fn().mockRejectedValue(new Error("tempo down"));
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByOperation(params);
		expect(res).toEqual({ err: "tempo down", data: [] });
	});
});

describe("externalResultGenerationBySystem", () => {
	it("groups by db.system using the g0 alias", async () => {
		const aggregateSpans = jest.fn().mockResolvedValue({
			rows: [{ g0: "pinecone", count: 5 }],
		});
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationBySystem(params);
		expect(res).toEqual({ err: null, data: [{ system: "pinecone", count: 5 }] });
	});

	it("returns an error payload on failure", async () => {
		const aggregateSpans = jest.fn().mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationBySystem(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});

describe("externalResultGenerationByEnvironment", () => {
	it("groups by deployment.environment", async () => {
		const aggregateSpans = jest.fn().mockResolvedValue({
			rows: [{ "deployment.environment": "prod", count: 2 }],
		});
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByEnvironment(params);
		expect(res).toEqual({ err: null, data: [{ environment: "prod", count: 2 }] });
	});

	it("returns an error payload on failure", async () => {
		const aggregateSpans = jest.fn().mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByEnvironment(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});

describe("externalResultGenerationByApplication", () => {
	it("groups by service.name", async () => {
		const aggregateSpans = jest.fn().mockResolvedValue({
			rows: [{ group_value: "api", count: 7 }],
		});
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByApplication(params);
		expect(res).toEqual({ err: null, data: [{ applicationName: "api", count: 7 }] });
	});

	it("returns an error payload on failure", async () => {
		const aggregateSpans = jest.fn().mockRejectedValue(new Error("boom"));
		mockGetAdapter.mockResolvedValue(adapterWith(aggregateSpans));

		const res = await externalResultGenerationByApplication(params);
		expect(res).toEqual({ err: "boom", data: [] });
	});
});
