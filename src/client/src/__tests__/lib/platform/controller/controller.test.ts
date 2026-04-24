jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
}));

import { dataCollector } from "@/lib/platform/common";
import {
	getConfigHash,
	upsertServices,
	getDesiredStatesForWorkloads,
	getServicesToReconcile,
	getControllerInstances,
	getControllerInstanceById,
	upsertControllerInstance,
	getDiscoveredServices,
	getServiceById,
	getControllerIdsForWorkload,
	getControllerConfig,
	saveControllerConfig,
	updateDesiredStatus,
	queueAction,
	getPendingActions,
	markActionsAcknowledged,
	completeAction,
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

	it("reads agent status from resource_attributes when top-level missing", async () => {
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
					resource_attributes: {
						"openlit.agent_observability.status": "enabled",
					},
				},
			],
			"default",
			"db-1"
		);

		expect(result.enableAgentKeys).toHaveLength(0);
	});

	it("filters out empty workload keys before querying", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);

		const result = await getServicesToReconcile(
			"ctrl-1",
			[{ workload_key: "", instrumentation_status: "discovered" }],
			"default",
			"db-1"
		);

		expect(mockedDataCollector).not.toHaveBeenCalled();
		expect(result.instrumentKeys).toHaveLength(0);
	});
});

describe("getControllerInstances", () => {
	it("runs a SELECT query against the instances table", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getControllerInstances("db-1");
		const call = mockedDataCollector.mock.calls[0];
		expect((call[0] as any).query).toContain("SELECT");
		expect(call[1]).toBe("query");
		expect(call[2]).toBe("db-1");
	});
});

describe("getControllerInstanceById", () => {
	it("includes the instance id in the query", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getControllerInstanceById("ctrl-123", "db-1");
		const call = mockedDataCollector.mock.calls[0];
		expect((call[0] as any).query).toContain("ctrl-123");
	});
});

describe("upsertControllerInstance", () => {
	it("calls dataCollector with insert", async () => {
		mockedDataCollector.mockResolvedValue({ data: "ok" } as any);
		await upsertControllerInstance({ instance_id: "ctrl-1" }, "db-1");
		expect(mockedDataCollector).toHaveBeenCalledWith(
			expect.objectContaining({
				table: expect.any(String),
				values: [{ instance_id: "ctrl-1" }],
			}),
			"insert",
			"db-1"
		);
	});
});

describe("getDiscoveredServices", () => {
	it("injects a time filter when start/end provided", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getDiscoveredServices(
			"2026-04-01 00:00:00",
			"2026-04-14 23:59:59",
			"db-1"
		);
		const q = (mockedDataCollector.mock.calls[0][0] as any).query;
		expect(q).toContain("2026-04-01 00:00:00");
		expect(q).toContain("2026-04-14 23:59:59");
	});

	it("omits time filter when not provided", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getDiscoveredServices(undefined, undefined, "db-1");
		const q = (mockedDataCollector.mock.calls[0][0] as any).query;
		expect(q).not.toContain("last_seen >=");
	});
});

describe("getServiceById", () => {
	it("escapes single quotes in the service id", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getServiceById("svc'1", "db-1");
		const q = (mockedDataCollector.mock.calls[0][0] as any).query;
		expect(q).toContain("svc\\'1");
	});
});

describe("getControllerIdsForWorkload", () => {
	it("escapes arguments when building the query", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getControllerIdsForWorkload(
			"my'svc",
			"ns",
			"cluster-1",
			"db-1"
		);
		const q = (mockedDataCollector.mock.calls[0][0] as any).query;
		expect(q).toContain("my\\'svc");
		expect(q).toContain("cluster-1");
	});

	it("defaults cluster id to 'default'", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getControllerIdsForWorkload("svc", "ns");
		const q = (mockedDataCollector.mock.calls[0][0] as any).query;
		expect(q).toContain("'default'");
	});
});

describe("getControllerConfig", () => {
	it("queries the config table with the given instance id", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getControllerConfig("ctrl-abc", "db-1");
		const q = (mockedDataCollector.mock.calls[0][0] as any).query;
		expect(q).toContain("ctrl-abc");
	});
});

describe("saveControllerConfig", () => {
	it("serializes config to JSON before inserting", async () => {
		mockedDataCollector.mockResolvedValue({ data: "ok" } as any);
		const cfg = { obi_enabled: true } as any;
		await saveControllerConfig("ctrl-1", cfg, "db-1");
		const [args, action, dbId] = mockedDataCollector.mock.calls[0];
		expect((args as any).values[0].instance_id).toBe("ctrl-1");
		expect((args as any).values[0].config).toBe(JSON.stringify(cfg));
		expect((args as any).values[0].updated_at).toBeDefined();
		expect(action).toBe("insert");
		expect(dbId).toBe("db-1");
	});
});

describe("updateDesiredStatus", () => {
	it("returns ok when both fields are undefined", async () => {
		const result = await updateDesiredStatus("wk-1", "default", {}, "db-1");
		expect(result).toEqual({ data: "ok" });
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("inserts with provided instrumentation field, preserving existing agent", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({
				data: [
					{
						workload_key: "wk-1",
						desired_instrumentation_status: "none",
						desired_agent_status: "enabled",
					},
				],
			} as any)
			.mockResolvedValueOnce({ data: "ok" } as any);

		await updateDesiredStatus(
			"wk-1",
			"default",
			{ desired_instrumentation_status: "instrumented" },
			"db-1"
		);

		const insertCall = mockedDataCollector.mock.calls[1];
		const row = (insertCall[0] as any).values[0];
		expect(row.desired_instrumentation_status).toBe("instrumented");
		expect(row.desired_agent_status).toBe("enabled");
	});

	it("writes both fields directly when both are provided (no lookup)", async () => {
		mockedDataCollector.mockResolvedValue({ data: "ok" } as any);
		await updateDesiredStatus(
			"wk-1",
			"default",
			{
				desired_instrumentation_status: "instrumented",
				desired_agent_status: "enabled",
			},
			"db-1"
		);
		expect(mockedDataCollector).toHaveBeenCalledTimes(1);
		const row = (mockedDataCollector.mock.calls[0][0] as any).values[0];
		expect(row.desired_instrumentation_status).toBe("instrumented");
		expect(row.desired_agent_status).toBe("enabled");
	});
});

describe("queueAction", () => {
	it("returns the existing action when a duplicate is pending", async () => {
		mockedDataCollector.mockResolvedValueOnce({
			data: [
				{ id: "act-1", action_type: "instrument", status: "pending" },
			],
		} as any);

		const result = await queueAction(
			"ctrl-1",
			"instrument" as any,
			"wk-1",
			"{}",
			"db-1"
		);
		expect((result as any).data.id).toBe("act-1");
		expect(mockedDataCollector).toHaveBeenCalledTimes(1);
	});

	it("inserts a new action when none exists", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({ data: [] } as any)
			.mockResolvedValueOnce({ data: "ok" } as any);

		await queueAction("ctrl-1", "instrument" as any, "wk-1", "{}", "db-1");
		expect(mockedDataCollector).toHaveBeenCalledTimes(2);
		const insert = mockedDataCollector.mock.calls[1];
		const row = (insert[0] as any).values[0];
		expect(row.instance_id).toBe("ctrl-1");
		expect(row.service_key).toBe("wk-1");
		expect(row.status).toBe("pending");
	});
});

describe("getPendingActions", () => {
	it("queries for pending actions by instance id", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		await getPendingActions("ctrl-1", "db-1");
		const q = (mockedDataCollector.mock.calls[0][0] as any).query;
		expect(q).toContain("ctrl-1");
		expect(q).toContain("'pending'");
	});
});

describe("markActionsAcknowledged", () => {
	it("returns ok without calling dataCollector for empty list", async () => {
		const result = await markActionsAcknowledged([], "ctrl-1", "db-1");
		expect(result).toEqual({ data: "ok" });
		expect(mockedDataCollector).not.toHaveBeenCalled();
	});

	it("writes each action with acknowledged status", async () => {
		mockedDataCollector.mockResolvedValue({ data: "ok" } as any);
		await markActionsAcknowledged(
			[
				{
					id: "act-1",
					action_type: "instrument",
					service_key: "wk-1",
					payload: "{}",
				} as any,
			],
			"ctrl-1",
			"db-1"
		);
		const rows = (mockedDataCollector.mock.calls[0][0] as any).values;
		expect(rows[0].status).toBe("acknowledged");
		expect(rows[0].instance_id).toBe("ctrl-1");
	});
});

describe("completeAction", () => {
	it("returns err when action is not found", async () => {
		mockedDataCollector.mockResolvedValue({ data: [] } as any);
		const result = await completeAction(
			"act-missing",
			"ctrl-1",
			"completed",
			"",
			"db-1"
		);
		expect((result as any).err).toContain("act-missing");
	});

	it("propagates err from the lookup query", async () => {
		mockedDataCollector.mockResolvedValue({ err: "db down" } as any);
		const result = await completeAction(
			"act-1",
			"ctrl-1",
			"completed",
			"",
			"db-1"
		);
		expect((result as any).err).toBe("db down");
	});

	it("inserts the completed row with the provided status and result", async () => {
		mockedDataCollector
			.mockResolvedValueOnce({
				data: [
					{
						id: "act-1",
						instance_id: "ctrl-1",
						action_type: "instrument",
						service_key: "wk-1",
						payload: "{}",
						created_at: "2026-04-01 00:00:00",
					},
				],
			} as any)
			.mockResolvedValueOnce({ data: "ok" } as any);

		await completeAction("act-1", "ctrl-1", "failed", "boom", "db-1");
		const row = (mockedDataCollector.mock.calls[1][0] as any).values[0];
		expect(row.status).toBe("failed");
		expect(row.result).toBe("boom");
		expect(row.id).toBe("act-1");
	});
});
