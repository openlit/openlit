/**
 * Single-flight SWR cache tests.
 */

import {
	swr,
	invalidate,
	invalidatePrefix,
	_resetForTests,
	_cacheSizeForTests,
} from "@/lib/platform/agents/cache";

beforeEach(() => {
	_resetForTests();
});

describe("swr cache", () => {
	it("returns the same value on repeated calls within fresh window", async () => {
		let calls = 0;
		const loader = jest.fn(async () => {
			calls += 1;
			return calls;
		});
		const policy = { freshMs: 1000, staleMs: 5000 };

		const a = await swr("k1", policy, loader);
		const b = await swr("k1", policy, loader);
		expect(a).toBe(1);
		expect(b).toBe(1);
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it("collapses concurrent loads into a single flight", async () => {
		let resolve: (v: number) => void = () => undefined;
		const loader = jest.fn(
			() =>
				new Promise<number>((res) => {
					resolve = res;
				})
		);
		const policy = { freshMs: 1000, staleMs: 5000 };

		const promises = [
			swr("k2", policy, loader),
			swr("k2", policy, loader),
			swr("k2", policy, loader),
		];
		// All three should share the same promise; loader called once only.
		expect(loader).toHaveBeenCalledTimes(1);
		resolve(42);
		const results = await Promise.all(promises);
		expect(results).toEqual([42, 42, 42]);
	});

	it("uses stale value while revalidating", async () => {
		let counter = 0;
		const loader = jest.fn(async () => {
			counter += 1;
			return counter;
		});
		const policy = { freshMs: 1, staleMs: 60_000 };

		const first = await swr("k3", policy, loader);
		expect(first).toBe(1);

		// Wait past fresh window.
		await new Promise((r) => setTimeout(r, 5));

		const second = await swr("k3", policy, loader);
		// Stale value returned immediately while background refresh runs.
		expect(second).toBe(1);

		// Let the background refresh settle.
		await new Promise((r) => setTimeout(r, 5));

		const third = await swr("k3", policy, loader);
		expect(third).toBe(2);
	});

	it("invalidate drops the entry", async () => {
		const loader = jest.fn(async () => "value");
		await swr("k4", { freshMs: 1000, staleMs: 5000 }, loader);
		expect(_cacheSizeForTests()).toBe(1);
		invalidate("k4");
		expect(_cacheSizeForTests()).toBe(0);
	});

	it("invalidatePrefix wipes everything under a namespace", async () => {
		const policy = { freshMs: 1000, staleMs: 5000 };
		await swr("agents:list:db1:a", policy, async () => 1);
		await swr("agents:list:db1:b", policy, async () => 2);
		await swr("agents:list:db2:a", policy, async () => 3);
		expect(_cacheSizeForTests()).toBe(3);
		invalidatePrefix("agents:list:db1:");
		expect(_cacheSizeForTests()).toBe(1);
	});
});
