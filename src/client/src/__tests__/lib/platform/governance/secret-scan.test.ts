import { detectSecretKinds, scanSpanPayloads } from "@/lib/platform/governance/secret-scan";

describe("governance secret scan", () => {
	it("detects high-confidence credential kinds without returning the value", () => {
		const sample =
			"AKIAIOSFODNN7EXAMPLE and ghp_abcdefghijklmnopqrstuvwxyz0123456789";
		expect(detectSecretKinds(sample)).toEqual(
			expect.arrayContaining(["aws_access_key", "github_token"])
		);
	});

	it("scans tool payload attributes only", () => {
		const kinds = scanSpanPayloads({
			"gen_ai.tool.args": '{"password":"supersecretvalue"}',
			"gen_ai.request.model": "gpt-4o",
		});
		expect(kinds).toContain("password_assignment");
	});

	it("does not flag ordinary tool arguments", () => {
		expect(
			scanSpanPayloads({
				"gen_ai.tool.args": '{"path":"/tmp/demo.ts","limit":20}',
			})
		).toEqual([]);
	});
});
