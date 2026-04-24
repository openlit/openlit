/**
 * Tests for the ClickHouse escaping function used in controller queries.
 * This is security-critical: improper escaping could allow SQL injection.
 */

function escapeClickHouse(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

describe("escapeClickHouse", () => {
	it("escapes single quotes", () => {
		expect(escapeClickHouse("it's")).toBe("it\\'s");
	});

	it("escapes backslashes", () => {
		expect(escapeClickHouse("path\\to\\file")).toBe("path\\\\to\\\\file");
	});

	it("escapes both together", () => {
		expect(escapeClickHouse("it's a\\path")).toBe("it\\'s a\\\\path");
	});

	it("leaves safe strings unchanged", () => {
		expect(escapeClickHouse("hello-world_123")).toBe("hello-world_123");
	});

	it("handles empty string", () => {
		expect(escapeClickHouse("")).toBe("");
	});

	it("handles multiple single quotes", () => {
		expect(escapeClickHouse("a''b")).toBe("a\\'\\'b");
	});

	it("escapes SQL injection attempts", () => {
		const malicious = "'; DROP TABLE openlit_controller_services; --";
		const escaped = escapeClickHouse(malicious);
		expect(escaped).toBe("\\'; DROP TABLE openlit_controller_services; --");
		expect(escaped.startsWith("\\'")).toBe(true);
	});
});
