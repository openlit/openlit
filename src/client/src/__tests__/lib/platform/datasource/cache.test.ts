import {
	__clearCache,
	cachedQuery,
	cacheKey,
} from "@/lib/platform/connectors/datasource/http/cache";

beforeEach(() => __clearCache());

describe("cacheKey", () => {
	it("is stable regardless of key order", () => {
		expect(cacheKey("s1", { b: 1, a: 2 })).toBe(cacheKey("s1", { a: 2, b: 1 }));
	});
	it("differs by source id", () => {
		expect(cacheKey("s1", { a: 1 })).not.toBe(cacheKey("s2", { a: 1 }));
	});
});

describe("cachedQuery", () => {
	it("caches results within TTL", async () => {
		const loader = jest.fn().mockResolvedValue(42);
		const key = cacheKey("s1", { q: 1 });
		expect(await cachedQuery(key, 1000, loader)).toBe(42);
		expect(await cachedQuery(key, 1000, loader)).toBe(42);
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it("coalesces concurrent identical requests", async () => {
		let resolve!: (v: number) => void;
		const loader = jest.fn().mockReturnValue(
			new Promise<number>((r) => {
				resolve = r;
			})
		);
		const key = cacheKey("s1", { q: 2 });
		const p1 = cachedQuery(key, 1000, loader);
		const p2 = cachedQuery(key, 1000, loader);
		resolve(7);
		expect(await p1).toBe(7);
		expect(await p2).toBe(7);
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it("reloads after TTL expiry", async () => {
		const loader = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
		const key = cacheKey("s1", { q: 3 });
		expect(await cachedQuery(key, 0, loader)).toBe(1);
		await new Promise((r) => setTimeout(r, 5));
		expect(await cachedQuery(key, 0, loader)).toBe(2);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it("evicts oldest entries when the byte budget is exceeded", async () => {
		const { MAX_CACHE_BYTES, __cacheStats } = await import(
			"@/lib/platform/connectors/datasource/http/cache"
		);
		// Force a tiny budget by caching several large payloads under the real
		// MAX_CACHE_BYTES ceiling (skip-single-payload path is > MAX).
		const chunk = "y".repeat(Math.floor(MAX_CACHE_BYTES / 3));
		await cachedQuery(cacheKey("s1", { n: 1 }), 60_000, async () => chunk);
		await cachedQuery(cacheKey("s1", { n: 2 }), 60_000, async () => chunk);
		await cachedQuery(cacheKey("s1", { n: 3 }), 60_000, async () => chunk);
		await cachedQuery(cacheKey("s1", { n: 4 }), 60_000, async () => chunk);
		const stats = __cacheStats();
		expect(stats.entries).toBeLessThan(4);
		expect(stats.bytes).toBeLessThanOrEqual(MAX_CACHE_BYTES);
	});
});
