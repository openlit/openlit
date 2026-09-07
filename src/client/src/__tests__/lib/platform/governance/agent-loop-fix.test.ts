import {
	agentLoopFixContext,
	buildAgentLoopKnowledgeRule,
	buildAgentLoopOtterPrompt,
} from "@/lib/platform/governance/agent-loop-fix";

describe("agent-loop-fix", () => {
	const finding = {
		resource: "/Users/nii/openlit/README.md",
		evidence: {
			tool_name: "read_file",
			count: 5,
			args_fingerprint: '{"path":"/Users/nii/openlit/README.md"}',
		},
	};

	it("extracts loop context from finding evidence", () => {
		expect(agentLoopFixContext(finding)).toEqual({
			tool: "read_file",
			count: 5,
			resource: "/Users/nii/openlit/README.md",
			fingerprint: '{"path":"/Users/nii/openlit/README.md"}',
		});
	});

	it("builds a paste-ready agent knowledge rule", () => {
		const rule = buildAgentLoopKnowledgeRule(finding);
		expect(rule).toContain("Tool-loop guard (read_file)");
		expect(rule).toContain("AGENTS.md");
		expect(rule).toContain(".cursor/rules/");
		expect(rule).toContain("read_file");
		expect(rule).toContain("README.md");
		expect(rule).not.toMatch(/interrupt/i);
	});

	it("builds an Otter prompt that prefers durable knowledge over interrupt", () => {
		const prompt = buildAgentLoopOtterPrompt(
			"Draft a rule for this loop",
			finding
		);
		expect(prompt).toContain("Tool: read_file");
		expect(prompt).toContain("Repeat count: 5");
		expect(prompt).toContain("AGENTS.md");
		expect(prompt).toContain("Draft a rule for this loop");
		expect(prompt).not.toMatch(/Stop or interrupt/i);
		expect(prompt).toMatch(/cannot interrupt|durable agent knowledge/i);
	});
});
