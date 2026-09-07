import type { TraceHeirarchySpan } from "@/types/trace";
import {
	flattenHierarchy,
	classifySpanRole,
	ruleFieldsFromHierarchySpan,
} from "@/lib/platform/governance/hierarchy";
import {
	buildHarnessMetrics,
	buildSecurityFindings,
	summarizeGovernanceReport,
} from "@/lib/platform/governance/security-checks";

function makeSpan(
	overrides: Partial<TraceHeirarchySpan> & Pick<TraceHeirarchySpan, "SpanId" | "SpanName">
): TraceHeirarchySpan {
	return {
		Duration: 1_000_000,
		SpanAttributes: {},
		ResourceAttributes: {},
		children: [],
		...overrides,
	};
}

describe("governance hierarchy", () => {
	it("flattens nested spans", () => {
		const root = makeSpan({
			SpanId: "root",
			SpanName: "root",
			children: [
				makeSpan({ SpanId: "child", SpanName: "child" }),
			],
		});
		const flat = flattenHierarchy(root);
		expect(flat.map((s) => s.SpanId)).toEqual(["root", "child"]);
	});

	it("extracts rule fields from span attributes", () => {
		const span = makeSpan({
			SpanId: "s1",
			SpanName: "chat",
			ServiceName: "my-svc",
			SpanAttributes: {
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.system": "openai",
			},
			ResourceAttributes: {
				"deployment.environment": "production",
			},
		});
		const fields = ruleFieldsFromHierarchySpan(span);
		expect(fields.ServiceName).toBe("my-svc");
		expect(fields.SpanName).toBe("chat");
		expect(fields["gen_ai.request.model"]).toBe("gpt-4o");
		expect(fields["deployment.environment"]).toBe("production");
	});

	it("classifies tool spans", () => {
		const span = makeSpan({
			SpanId: "t1",
			SpanName: "tool.call",
			SpanAttributes: { "gen_ai.tool.name": "search" },
		});
		expect(classifySpanRole(span)).toBe("tool");
	});
});

describe("governance security checks", () => {
	it("flags span errors and generation health", () => {
		const spans = [
			makeSpan({
				SpanId: "err",
				SpanName: "llm",
				StatusCode: "STATUS_CODE_ERROR",
				StatusMessage: "boom",
				SpanAttributes: {
					"gen_ai.response.finish_reasons": "length",
					"gen_ai.request.model": "gpt-4o",
					"gen_ai.response.model": "gpt-4o-mini",
					"gen_ai.usage.output_tokens": 0,
				},
			}),
		];
		const findings = buildSecurityFindings(spans);
		expect(findings.some((f) => f.category === "span_error")).toBe(true);
		expect(findings.some((f) => f.category === "generation_health")).toBe(true);
	});

	it("builds harness metrics", () => {
		const root = makeSpan({
			SpanId: "root",
			SpanName: "agent",
			children: [
				makeSpan({
					SpanId: "tool",
					SpanName: "tool.call",
					SpanAttributes: { "gen_ai.tool.name": "bash" },
				}),
			],
		});
		const spans = flattenHierarchy(root);
		const harness = buildHarnessMetrics(root, spans);
		expect(harness.span_count).toBe(2);
		expect(harness.tool_call_count).toBe(1);
		expect(harness.tools_used).toContain("bash");
		expect(harness.total_tokens).toBe(0);
		expect(harness.cost_reported).toBe(false);
	});

	it("prefers session token rollups on the root for harness totals", () => {
		const root = makeSpan({
			SpanId: "root",
			SpanName: "coding_agent.session",
			SpanAttributes: {
				"gen_ai.usage.total_tokens": 1200,
				"coding_agent.client": "cursor",
			},
			children: [],
		});
		const harness = buildHarnessMetrics(root, flattenHierarchy(root));
		expect(harness.total_tokens).toBe(1200);
		expect(harness.cost_reported).toBe(false);
	});

	it("summarizes mixed governance posture", () => {
		const summary = summarizeGovernanceReport(
			[
				{
					id: "f1",
					category: "span_error",
					severity: "major",
					summary: "err",
					detail: "err",
					span_refs: ["a"],
				},
			],
			2,
			1
		);
		expect(summary.risk_level).toBe("major");
		expect(summary.summary).toContain("2");
	});

	it("attaches real span ids and remediation for agent loops", () => {
		const args = '{"path":"/Users/nii/openlit/README.md"}';
		const spans = [
			makeSpan({
				SpanId: "loop-1",
				SpanName: "coding_agent.tool.call",
				TraceId: "t1",
				SpanAttributes: {
					"gen_ai.tool.name": "read_file",
					"gen_ai.tool.args": args,
					"coding_agent.session.id": "sess-1",
				},
			}),
			makeSpan({
				SpanId: "loop-2",
				SpanName: "coding_agent.tool.call",
				TraceId: "t1",
				SpanAttributes: {
					"gen_ai.tool.name": "read_file",
					"gen_ai.tool.args": args,
					"coding_agent.session.id": "sess-1",
				},
			}),
			makeSpan({
				SpanId: "loop-3",
				SpanName: "coding_agent.tool.call",
				TraceId: "t1",
				SpanAttributes: {
					"gen_ai.tool.name": "read_file",
					"gen_ai.tool.args": args,
					"coding_agent.session.id": "sess-1",
				},
			}),
		];
		const findings = buildSecurityFindings(spans);
		const loop = findings.find((f) => f.category === "agent_loop");
		expect(loop).toBeTruthy();
		expect(loop?.span_refs).toEqual(
			expect.arrayContaining(["loop-1", "loop-2", "loop-3"])
		);
		expect(loop?.span_refs.every((id) => id.startsWith("loop-"))).toBe(true);
		expect(loop?.resource).toContain("README.md");
		expect(loop?.remediation).toBeTruthy();
		expect(loop?.remediation).toMatch(/AGENTS\.md|\.cursor\/rules/i);
		expect(loop?.remediation).not.toMatch(/Stop or interrupt/i);
	});

	it("dedupes permission-mode findings across spans", () => {
		const spans = [
			makeSpan({
				SpanId: "p1",
				SpanName: "coding_agent.session",
				SpanAttributes: {
					"coding_agent.policy.permission_mode": "agent",
				},
			}),
			makeSpan({
				SpanId: "p2",
				SpanName: "coding_agent.tool.call",
				SpanAttributes: {
					"coding_agent.policy.permission_mode": "agent",
				},
			}),
		];
		const findings = buildSecurityFindings(spans).filter(
			(f) => f.category === "policy"
		);
		expect(findings).toHaveLength(1);
		expect(findings[0].span_refs).toEqual(expect.arrayContaining(["p1", "p2"]));
		expect(findings[0].remediation).toBeTruthy();
	});
});
