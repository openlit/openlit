class TestHeaders {
	private map = new Map<string, string>();

	constructor(init?: TestHeaders | Record<string, string> | null) {
		if (init instanceof TestHeaders) {
			init.map.forEach((value, key) => this.map.set(key, value));
		} else if (init && typeof (init as { forEach?: unknown }).forEach === "function") {
			(init as unknown as { forEach: (cb: (v: string, k: string) => void) => void }).forEach(
				(value, key) => this.map.set(key.toLowerCase(), value)
			);
		} else if (init) {
			Object.entries(init).forEach(([key, value]) => this.map.set(key.toLowerCase(), value));
		}
	}

	get(key: string) {
		return this.map.get(key.toLowerCase()) ?? null;
	}

	set(key: string, value: string) {
		this.map.set(key.toLowerCase(), value);
	}

	forEach(cb: (value: string, key: string) => void) {
		this.map.forEach((value, key) => cb(value, key));
	}
}

class TestResponse {
	status: number;
	statusText: string;
	headers: TestHeaders;
	body: unknown;

	constructor(
		body?: unknown,
		init?: { status?: number; statusText?: string; headers?: TestHeaders | Record<string, string> }
	) {
		this.body = body;
		this.status = init?.status ?? 200;
		this.statusText = init?.statusText ?? "";
		this.headers = new TestHeaders(init?.headers);
	}

	static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
		return new TestResponse(JSON.stringify(body), init);
	}

	async json() {
		return typeof this.body === "string" ? JSON.parse(this.body) : this.body;
	}
}

(globalThis as unknown as { Response: unknown }).Response = TestResponse;
(globalThis as unknown as { Headers: unknown }).Headers = TestHeaders;

import {
	deprecatedObservabilityResponse,
	jsonWithObservabilityDeprecation,
} from "@/lib/platform/observability-deprecation";

describe("deprecatedObservabilityResponse", () => {
	it("stamps Deprecation, Link, and alias headers while preserving status/body", () => {
		const original = new Response("hello", { status: 201, statusText: "Created" });

		const result = deprecatedObservabilityResponse(
			original as unknown as Response,
			"/api/telemetry/logs"
		) as unknown as TestResponse;

		expect(result.status).toBe(201);
		expect(result.statusText).toBe("Created");
		expect(result.body).toBe("hello");
		expect(result.headers.get("Deprecation")).toBe("true");
		expect(result.headers.get("Link")).toBe('</api/telemetry/logs>; rel="successor-version"');
		expect(result.headers.get("X-OpenLIT-Deprecated-Alias")).toBe("observability→telemetry");
	});

	it("preserves pre-existing headers on the original response", () => {
		const original = new Response("body", {
			status: 200,
			headers: { "x-custom": "keep-me" },
		});

		const result = deprecatedObservabilityResponse(
			original as unknown as Response,
			"/api/telemetry/metrics"
		) as unknown as TestResponse;

		expect(result.headers.get("x-custom")).toBe("keep-me");
		expect(result.headers.get("Deprecation")).toBe("true");
	});

	it("defaults status to 200 when the original response omits it", () => {
		const original = new Response("body");

		const result = deprecatedObservabilityResponse(
			original as unknown as Response,
			"/api/telemetry/traces"
		) as unknown as TestResponse;

		expect(result.status).toBe(200);
	});
});

describe("jsonWithObservabilityDeprecation", () => {
	it("serializes the body and stamps deprecation headers", async () => {
		const result = (await jsonWithObservabilityDeprecation(
			{ ok: true, count: 3 },
			"/api/telemetry/logs",
			{ status: 202 }
		)) as unknown as TestResponse;

		expect(result.status).toBe(202);
		expect(result.headers.get("Deprecation")).toBe("true");
		expect(result.headers.get("Link")).toBe('</api/telemetry/logs>; rel="successor-version"');
		expect(await (result as unknown as { json: () => Promise<unknown> }).json()).toEqual({
			ok: true,
			count: 3,
		});
	});

	it("defaults to status 200 when no init is provided", async () => {
		const result = (await jsonWithObservabilityDeprecation(
			{ hello: "world" },
			"/api/telemetry/metrics"
		)) as unknown as TestResponse;

		expect(result.status).toBe(200);
		expect(await (result as unknown as { json: () => Promise<unknown> }).json()).toEqual({
			hello: "world",
		});
	});
});
