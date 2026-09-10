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
				"gen_ai.tool.name": "Shell",
				"coding_agent.policy.permission_mode": "bypassPermissions",
				"coding_agent.client": "cursor",
			},
			ResourceAttributes: {
				"deployment.environment": "production",
				"coding_agent.content_capture_mode": "metadata_only",
			},
		});
		const fields = ruleFieldsFromHierarchySpan(span);
		expect(fields.ServiceName).toBe("my-svc");
		expect(fields.SpanName).toBe("chat");
		expect(fields["gen_ai.request.model"]).toBe("gpt-4o");
		expect(fields["deployment.environment"]).toBe("production");
		expect(fields["gen_ai.tool.name"]).toBe("Shell");
		expect(fields["coding_agent.policy.permission_mode"]).toBe(
			"bypassPermissions"
		);
		expect(fields["coding_agent.client"]).toBe("cursor");
		expect(fields["coding_agent.content_capture_mode"]).toBe("metadata_only");
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

	it("flags leftover coding-agent governance findings", () => {
		const spans = [
			makeSpan({
				SpanId: "session",
				SpanName: "coding_agent.session",
				SpanAttributes: {
					"coding_agent.content_capture_mode": "full",
					"coding_agent.session.outcome": "abandoned_with_change",
					"coding_agent.session.edit.reject_count": 3,
					"coding_agent.session.edit.accept_count": 1,
					"coding_agent.session.commit_count": 3,
					"coding_agent.session.pr_count": 2,
					"coding_agent.session.subagent_count": 4,
					"coding_agent.session.lines.added": 12,
					"coding_agent.vcs.dirty": "true",
					"coding_agent.mcp.server.name": "browser",
					"coding_agent.mcp.scope": "user",
					"coding_agent.mcp.source": "marketplace",
				},
			}),
			makeSpan({
				SpanId: "tool-secret",
				SpanName: "coding_agent.tool.call",
				SpanAttributes: {
					"gen_ai.tool.name": "write",
					"gen_ai.tool.args": '{"token":"AKIAIOSFODNN7EXAMPLE"}',
				},
			}),
		];
		const findings = buildSecurityFindings(spans);
		expect(findings.some((f) => f.evidence?.content_capture_mode === "full")).toBe(
			true
		);
		expect(findings.some((f) => f.evidence?.session_outcome === "abandoned_with_change")).toBe(
			true
		);
		expect(findings.some((f) => f.evidence?.edit_reject_count === 3)).toBe(true);
		expect(findings.some((f) => f.evidence?.vcs_dirty === true)).toBe(true);
		expect(findings.some((f) => f.evidence?.mcp_scope === "user_or_local")).toBe(
			true
		);
		expect(findings.some((f) => f.evidence?.mcp_source === "marketplace")).toBe(
			true
		);
		expect(findings.some((f) => f.evidence?.commit_count === 3)).toBe(true);
		expect(findings.some((f) => f.evidence?.subagent_count === 4)).toBe(true);
		const secret = findings.find((f) =>
			String(f.evidence?.secret_kinds || "").includes("aws_access_key")
		);
		expect(secret).toBeTruthy();
		expect(JSON.stringify(secret)).not.toContain("AKIAIOSFODNN7EXAMPLE");
	});

	it("does not flag a dirty tree when the agent did not write", () => {
		const findings = buildSecurityFindings([
			makeSpan({
				SpanId: "session",
				SpanName: "coding_agent.session",
				SpanAttributes: {
					"coding_agent.vcs.dirty": "true",
					"coding_agent.session.outcome": "completed",
				},
			}),
		]);
		expect(findings.some((f) => f.evidence?.vcs_dirty)).toBe(false);
	});

	it("does not flag healthy coding-agent defaults", () => {
		const spans = [
			makeSpan({
				SpanId: "session",
				SpanName: "coding_agent.session",
				SpanAttributes: {
					"coding_agent.content_capture_mode": "metadata_only",
					"coding_agent.session.outcome": "completed",
					"coding_agent.session.edit.reject_count": 1,
					"coding_agent.session.edit.accept_count": 8,
					"coding_agent.session.commit_count": 1,
					"coding_agent.session.pr_count": 1,
					"coding_agent.session.subagent_count": 1,
					"coding_agent.vcs.dirty": "false",
					"coding_agent.mcp.server.name": "repo",
					"coding_agent.mcp.scope": "project",
					"coding_agent.mcp.source": "builtin",
				},
			}),
		];
		const findings = buildSecurityFindings(spans);
		expect(findings).toEqual([]);
	});
});
