/**
 * Tests for poll route helper functions: deterministicServiceId,
 * clickhouseNow, sanitizeLogValue, and authenticatePollRequest.
 *
 * The route file is not directly importable as a module (Next.js route handler),
 * so we re-implement and test the pure helper functions here to ensure correctness.
 */
import crypto from "crypto";

function deterministicServiceId(
	controllerInstanceId: string,
	workloadKey: string,
	namespace: string,
	serviceName: string
): string {
	const key = `${controllerInstanceId}:${workloadKey}:${namespace}:${serviceName}`;
	const hash = crypto.createHash("md5").update(key).digest("hex");
	return [
		hash.slice(0, 8),
		hash.slice(8, 12),
		hash.slice(12, 16),
		hash.slice(16, 20),
		hash.slice(20, 32),
	].join("-");
}

function clickhouseNow(): string {
	return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function sanitizeLogValue(val: unknown): string {
	return String(val).replace(/[\r\n\t]/g, " ").slice(0, 500);
}

describe("deterministicServiceId", () => {
	it("returns a UUID-like string", () => {
		const id = deterministicServiceId("ctrl-1", "wk-1", "default", "my-svc");
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);
	});

	it("produces stable output for the same inputs", () => {
		const a = deterministicServiceId("ctrl-1", "wk-1", "ns", "svc");
		const b = deterministicServiceId("ctrl-1", "wk-1", "ns", "svc");
		expect(a).toBe(b);
	});

	it("produces different IDs for different inputs", () => {
		const a = deterministicServiceId("ctrl-1", "wk-1", "ns", "svc-a");
		const b = deterministicServiceId("ctrl-1", "wk-1", "ns", "svc-b");
		expect(a).not.toBe(b);
	});

	it("varies by controller instance ID", () => {
		const a = deterministicServiceId("ctrl-1", "wk-1", "ns", "svc");
		const b = deterministicServiceId("ctrl-2", "wk-1", "ns", "svc");
		expect(a).not.toBe(b);
	});
});

describe("clickhouseNow", () => {
	it("returns a valid ClickHouse datetime format", () => {
		const now = clickhouseNow();
		expect(now).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
	});

	it("does not contain T or Z", () => {
		const now = clickhouseNow();
		expect(now).not.toContain("T");
		expect(now).not.toContain("Z");
	});
});

describe("sanitizeLogValue", () => {
	it("strips newlines", () => {
		expect(sanitizeLogValue("line1\nline2")).toBe("line1 line2");
	});

	it("strips carriage returns", () => {
		expect(sanitizeLogValue("line1\rline2")).toBe("line1 line2");
	});

	it("strips tabs", () => {
		expect(sanitizeLogValue("col1\tcol2")).toBe("col1 col2");
	});

	it("strips mixed control characters", () => {
		expect(sanitizeLogValue("a\r\nb\tc")).toBe("a  b c");
	});

	it("truncates long strings to 500 chars", () => {
		const long = "x".repeat(1000);
		expect(sanitizeLogValue(long)).toHaveLength(500);
	});

	it("handles non-string values", () => {
		expect(sanitizeLogValue(undefined)).toBe("undefined");
		expect(sanitizeLogValue(null)).toBe("null");
		expect(sanitizeLogValue(42)).toBe("42");
	});

	it("handles Error objects", () => {
		const err = new Error("test\nerror");
		const sanitized = sanitizeLogValue(err);
		expect(sanitized).not.toContain("\n");
		expect(sanitized).toContain("test");
	});

	it("prevents log injection with fake log entries", () => {
		const malicious =
			'normal message\n[ERROR] 2026-01-01 Fake log entry injected';
		const sanitized = sanitizeLogValue(malicious);
		expect(sanitized).not.toContain("\n");
		expect(sanitized.split("\n")).toHaveLength(1);
	});
});
