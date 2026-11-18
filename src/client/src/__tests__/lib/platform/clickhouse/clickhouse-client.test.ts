/** @jest-environment node */
const mockCreateClient = jest.fn();

jest.mock("@clickhouse/client", () => ({
	createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import createClickhousePool from "@/lib/platform/clickhouse/clickhouse-client";
import { tenantReadFilterSettings } from "@/lib/platform/clickhouse/tenant-read-filter";
import {
	CLICKHOUSE_READ_MAX_EXECUTION_SECONDS,
	SPAN_SEARCH_REQUEST_TIMEOUT_MS,
} from "@/constants/traces";

const baseConfig = {
	id: "db-1",
	username: "u",
	password: "p",
	host: "localhost",
	port: "8123",
	database: "openlit",
	query: "",
	projectId: "project-a",
	environment: "production",
} as any;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createClickhousePool", () => {
	beforeEach(() => {
		mockCreateClient.mockReset();
		mockCreateClient.mockImplementation(() => ({
			ping: jest.fn().mockResolvedValue({ success: true }),
			close: jest.fn().mockResolvedValue(undefined),
		}));
	});

	it("reuses one pool across queries for an unchanged config", () => {
		const id = "reuse";
		expect(createClickhousePool({ ...baseConfig, id })).toBe(
			createClickhousePool({ ...baseConfig, id })
		);
	});

	it("keeps no client in the pool until a query needs one", async () => {
		const pool = createClickhousePool({ ...baseConfig, id: "lazy" });
		await flush();
		expect(pool.size).toBe(0);
	});

	it("waits past the server ceiling, and the browser waits for two such reads", () => {
		createClickhousePool({ ...baseConfig, id: "timeout" });
		const { request_timeout } = mockCreateClient.mock.calls[0][0];
		expect(request_timeout).toBeGreaterThan(CLICKHOUSE_READ_MAX_EXECUTION_SECONDS * 1000);
		expect(SPAN_SEARCH_REQUEST_TIMEOUT_MS).toBeGreaterThan(
			2 * CLICKHOUSE_READ_MAX_EXECUTION_SECONDS * 1000
		);
	});

	it("closes the client that checks the config", async () => {
		createClickhousePool({ ...baseConfig, id: "checked" });
		await flush();
		expect(mockCreateClient.mock.results[0].value.close).toHaveBeenCalled();
	});

	it.each(["99999", "abc"])(
		"throws before a pool exists when the real client rejects port %s",
		(port) => {
			mockCreateClient.mockImplementation(
				jest.requireActual("@clickhouse/client").createClient
			);
			const config = { ...baseConfig, id: `bad-port-${port}`, port };
			expect(() => createClickhousePool(config)).toThrow("malformed");
			// A pool left behind would spin forever on its first acquire.
			expect(() => createClickhousePool(config)).toThrow("malformed");
		}
	);

	it("keeps the working pool when a changed config cannot build a client", async () => {
		const id = "bad-change";
		const before = createClickhousePool({ ...baseConfig, id });

		mockCreateClient.mockImplementationOnce(() => {
			throw new Error("bad config");
		});
		expect(() =>
			createClickhousePool({ ...baseConfig, id, port: "99999" })
		).toThrow("bad config");

		expect(createClickhousePool({ ...baseConfig, id })).toBe(before);
		await before.release(await before.acquire());
	});

	it("does not ping before each query", async () => {
		const pool = createClickhousePool({ ...baseConfig, id: "no-ping" });
		const client = await pool.acquire();
		expect(client.ping).not.toHaveBeenCalled();
		await pool.release(client);
	});

	it("never shares a pool between configs with identical connection details", () => {
		expect(createClickhousePool({ ...baseConfig, id: "tenant-a" })).not.toBe(
			createClickhousePool({ ...baseConfig, id: "tenant-b" })
		);
	});

	it("applies each tenant's own filter to the clients of its pool", async () => {
		const configA = { ...baseConfig, id: "filter-a", projectId: "project-a" };
		const configB = { ...baseConfig, id: "filter-b", projectId: "project-b" };

		const poolA = createClickhousePool(configA);
		await poolA.release(await poolA.acquire());
		const poolB = createClickhousePool(configB);
		await poolB.release(await poolB.acquire());

		const settings = mockCreateClient.mock.calls.map(
			([options]) => options.clickhouse_settings
		);
		expect(settings[0]).toEqual(tenantReadFilterSettings(configA));
		expect(settings[settings.length - 1]).toEqual(tenantReadFilterSettings(configB));
		expect(settings[0]).not.toEqual(settings[settings.length - 1]);
	});

	it("replaces the pool when tenant settings change for the same config id", async () => {
		const id = "tenant-change";
		const before = createClickhousePool({ ...baseConfig, id });
		const client = await before.acquire();
		await before.release(client);

		const after = createClickhousePool({
			...baseConfig,
			id,
			projectId: "project-b",
		});

		expect(after).not.toBe(before);
		await flush();
		expect(client.close).toHaveBeenCalled();
		await expect(before.acquire()).rejects.toThrow();
	});

	it("replaces the pool when a connection field changes", () => {
		const id = "password-change";
		const before = createClickhousePool({ ...baseConfig, id });
		expect(
			createClickhousePool({ ...baseConfig, id, password: "rotated" })
		).not.toBe(before);
	});

	it("lets an in-flight query finish on a replaced pool", async () => {
		const id = "in-flight";
		const before = createClickhousePool({ ...baseConfig, id });
		const client = await before.acquire();

		createClickhousePool({ ...baseConfig, id, host: "elsewhere" });
		await flush();
		expect(client.close).not.toHaveBeenCalled();

		await before.release(client);
		await flush();
		expect(client.close).toHaveBeenCalled();
	});

	it("queues a burst past the client limit instead of rejecting it", async () => {
		const pool = createClickhousePool({ ...baseConfig, id: "burst" });
		const burst = Array.from({ length: 60 }, async () => {
			const client = await pool.acquire();
			await flush();
			await pool.release(client);
		});
		await expect(Promise.all(burst)).resolves.toBeDefined();
	});
});
