import { API_REFERENCE_ENDPOINTS } from "@/constants/api-reference";

describe("API_REFERENCE_ENDPOINTS", () => {
	it("exports a non-empty endpoint list", () => {
		expect(Array.isArray(API_REFERENCE_ENDPOINTS)).toBe(true);
		expect(API_REFERENCE_ENDPOINTS.length).toBeGreaterThan(0);
	});

	it("includes core telemetry, vault, AI Analysis, and Ask Otter endpoints", () => {
		const ids = API_REFERENCE_ENDPOINTS.map((endpoint) => endpoint.id);
		expect(ids).toEqual(
			expect.arrayContaining([
				"query-logs",
				"query-metrics",
				"query-traces",
				"get-secrets",
				"create-prompt",
				"get-ai-analysis",
				"run-ai-analysis",
				"send-otter-message",
				"execute-otter-sql",
				"improve-prompt-otter",
			])
		);
	});

	it("each endpoint has required fields and a curl example", () => {
		for (const endpoint of API_REFERENCE_ENDPOINTS) {
			expect(endpoint.id).toBeTruthy();
			expect(["GET", "POST", "DELETE", "PUT"]).toContain(endpoint.method);
			expect(endpoint.path).toMatch(/^\/api\//);
			expect(endpoint.summary.length).toBeGreaterThan(0);
			expect(endpoint.description.length).toBeGreaterThan(0);
			expect(typeof endpoint.curlExample).toBe("function");
			const curl = endpoint.curlExample("test-key");
			expect(curl).toContain("test-key");
			expect(curl).toContain("Authorization: Bearer test-key");
			expect(curl).toContain("x-openlit-organisation-id");
			expect(curl).toContain("x-openlit-project-id");
			expect(curl).toContain("x-openlit-environment");
			expect(curl).not.toContain("x-openlit-database-config-id");
			expect(curl).not.toContain("Cookie: next-auth.session-token");
		}
	});
});
