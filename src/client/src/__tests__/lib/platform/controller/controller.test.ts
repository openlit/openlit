jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));

import { dataCollector } from "@/lib/platform/common";
import {
	getConfigHash,
	upsertServices,
	getDesiredStatesForWorkloads,
	getServicesToReconcile,
} from "@/lib/platform/controller";

const mockedDataCollector = dataCollector as jest.MockedFunction<
	typeof dataCollector
>;

beforeEach(() => {
	jest.clearAllMocks();
});

describe("getConfigHash", () => {
	it("returns a 16-char hex string", () => {
		const hash = getConfigHash({ obi_enabled: true } as any);
		expect(hash).toMatch(/^[0-9a-f]{16}$/);
	});

	it("returns the same hash for the same config", () => {
		const config = { obi_enabled: true, poll_interval: 60 } as any;
		expect(getConfigHash(config)).toBe(getConfigHash(config));
	});

	it("returns different hashes for different configs", () => {
		const a = getConfigHash({ obi_enabled: true } as any);
		const b = getConfigHash({ obi_enabled: false } as any);
		expect(a).not.toBe(b);
	});
});

describe("upsertServices", () => {
	it("returns immediately for empty array without calling dataCollector", async () => {
		const result = await upsertServices([], "db-1");
		expect(result).toEqual({ data: "ok" });
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("calls dataCollector with insert for non-empty services", async () => {
		mockedDataCollector.mockResolvedValue({ data: "ok" } as any);
		await upsertServices([{ id: "svc-1" }], "db-1");
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				table: expect.any(String),
				values: [{ id: "svc-1" }],
			}),
			"insert",
			"db-1"
		);
	});
});

describe("getDesiredStatesForWorkloads", () => {
	it("returns empty array for empty workload keys", async () => {
		const result = await getDesiredStatesForWorkloads([], "default", "db-1");
		expect(result).toEqual({ data: [] });
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("calls dataCollector with query for non-empty keys", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getDesiredStatesForWorkloads(
			["wk-1", "wk-2"],
			"default",
			"db-1"
		);
		expect(mockedDataCollector).toHaveBeenCalledTimes(1);
		const call = mockedDataCollector.mock.calls[0];
		expect((call[0] as any).query).toContain("wk-1");
		expect((call[0] as any).query).toContain("wk-2");
	});
});

describe("getServicesToReconcile", () => {
	it("returns empty arrays when no workload keys", async () => {
		const result = await getServicesToReconcile("ctrl-1", [], "default", "db-1");
		expect(result).toEqual({
			instrumentKeys: [],
			uninstrumentKeys: [],
			enableAgentKeys: [],
			disableAgentKeys: [],
		});
	});

	it("identifies services needing instrumentation", async () => {
		mockedDataCollector.mockResolvedValue({
			data: [
				{
					workload_key: "wk-1",
					desired_instrumentation_status: "instrumented",
					desired_agent_status: "none",
				},
			],
		} as any);

		const result = await getServicesToReconcile(
			"ctrl-1",
			[
				{
					workload_key: "wk-1",
					instrumentation_status: "discovered",
				},
			],
			"default",
			"db-1"
		);

		expect(result.instrumentKeys).toEqual(["wk-1"]);
		expect(result.uninstrumentKeys).toHaveLength(0);
	});

	it("identifies services needing uninstrumentation", async () => {
		mockedDataCollector.mockResolvedValue({
			data: [
				{
					workload_key: "wk-1",
					desired_instrumentation_status: "none",
					desired_agent_status: "none",
				},
			],
		} as any);

		const result = await getServicesToReconcile(
			"ctrl-1",
			[
				{
					workload_key: "wk-1",
					instrumentation_status: "instrumented",
				},
			],
			"default",
			"db-1"
		);

		expect(result.uninstrumentKeys).toEqual(["wk-1"]);
		expect(result.instrumentKeys).toHaveLength(0);
	});

	it("identifies services needing agent enablement", async () => {
		mockedDataCollector.mockResolvedValue({
			data: [
				{
					workload_key: "wk-1",
					desired_instrumentation_status: "none",
					desired_agent_status: "enabled",
				},
			],
		} as any);

		const result = await getServicesToReconcile(
			"ctrl-1",
			[
				{
					workload_key: "wk-1",
					instrumentation_status: "discovered",
				},
			],
			"default",
			"db-1"
		);

		expect(result.enableAgentKeys).toEqual(["wk-1"]);
	});

	it("identifies services needing agent disablement", async () => {
		mockedDataCollector.mockResolvedValue({
			data: [
				{
					workload_key: "wk-1",
					desired_instrumentation_status: "none",
					desired_agent_status: "none",
				},
			],
		} as any);

		const result = await getServicesToReconcile(
			"ctrl-1",
			[
				{
					workload_key: "wk-1",
					instrumentation_status: "discovered",
					resource_attributes: {
						"openlit.agent_observability.status": "enabled",
					},
				},
			],
			"default",
			"db-1"
		);

		expect(result.disableAgentKeys).toEqual(["wk-1"]);
	});

	it("skips services without desired state", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);

		const result = await getServicesToReconcile(
			"ctrl-1",
			[
				{
					workload_key: "wk-1",
					instrumentation_status: "discovered",
				},
			],
			"default",
			"db-1"
		);

		expect(result.instrumentKeys).toHaveLength(0);
		expect(result.enableAgentKeys).toHaveLength(0);
	});

	it("handles dataCollector error gracefully", async () => {
		mockedDataCollector.mockResolvedValue({ err: "connection failed" } as any);

		const result = await getServicesToReconcile(
			"ctrl-1",
			[{ workload_key: "wk-1", instrumentation_status: "discovered" }],
			"default",
			"db-1"
		);

		expect(result.instrumentKeys).toHaveLength(0);
	});
});
