/**
 * Fingerprint stability tests.
 *
 * The fingerprint is the contract that drives auto-versioning. It MUST be
 * deterministic across runs and resistant to noise that doesn't change the
 * meaning of the agent's definition.
 */

jest.mock("@/lib/platform/common", () => ({
	dataCollector: jest.fn(),
	OTEL_TRACES_TABLE_NAME: "otel_traces",
}));

import { fingerprint } from "@/lib/platform/agents/snapshot";

describe("fingerprint", () => {
	const baseTools = [
		{
			name: "search",
			description: "Search the web",
			schema: { type: "object", properties: { q: { type: "string" } } },
		},
		{
			name: "lookup",
			description: "Look up a record",
			schema: { type: "object", properties: { id: { type: "string" } } },
		},
	];

	const baseInput = {
		systemPrompt: "You are a helpful assistant.",
		tools: baseTools,
		primaryModel: "gpt-4o",
		runtimeConfig: { temperature: 0.7, top_p: 1, max_tokens: 1024 },
		providers: ["openai"],
	};

	it("is stable across calls for identical input", () => {
		const a = fingerprint(baseInput);
		const b = fingerprint(baseInput);
		expect(a).toBe(b);
	});

	it("returns a 16-character hex string", () => {
		const fp = fingerprint(baseInput);
		expect(fp).toMatch(/^[a-f0-9]{16}$/);
	});

	it("is invariant to whitespace noise in system prompt", () => {
		const a = fingerprint(baseInput);
		const b = fingerprint({
			...baseInput,
			systemPrompt: "  You are a   helpful\tassistant. ",
		});
		expect(a).toBe(b);
	});

	it("is invariant to tool ordering", () => {
		const a = fingerprint(baseInput);
		const b = fingerprint({
			...baseInput,
			tools: [...baseTools].reverse(),
		});
		expect(a).toBe(b);
	});

	it("is invariant to JSON schema key ordering", () => {
		const a = fingerprint(baseInput);
		const b = fingerprint({
			...baseInput,
			tools: [
				{
					...baseTools[0],
					schema: {
						properties: { q: { type: "string" } },
						type: "object",
					},
				},
				baseTools[1],
			],
		});
		expect(a).toBe(b);
	});

	it("is invariant to provider ordering", () => {
		const a = fingerprint({ ...baseInput, providers: ["openai", "anthropic"] });
		const b = fingerprint({ ...baseInput, providers: ["anthropic", "openai"] });
		expect(a).toBe(b);
	});

	it("rounds sampling params to 3 decimals", () => {
		const a = fingerprint({
			...baseInput,
			runtimeConfig: { ...baseInput.runtimeConfig, temperature: 0.7 },
		});
		const b = fingerprint({
			...baseInput,
			runtimeConfig: { ...baseInput.runtimeConfig, temperature: 0.70001 },
		});
		expect(a).toBe(b);

		const c = fingerprint({
			...baseInput,
			runtimeConfig: { ...baseInput.runtimeConfig, temperature: 0.71 },
		});
		expect(a).not.toBe(c);
	});

	it("changes when the system prompt meaningfully changes", () => {
		const a = fingerprint(baseInput);
		const b = fingerprint({
			...baseInput,
			systemPrompt: "You are a strict code reviewer.",
		});
		expect(a).not.toBe(b);
	});

	it("changes when the primary model changes", () => {
		const a = fingerprint(baseInput);
		const b = fingerprint({ ...baseInput, primaryModel: "claude-3.5-sonnet" });
		expect(a).not.toBe(b);
	});

	it("changes when a new tool is added", () => {
		const a = fingerprint(baseInput);
		const b = fingerprint({
			...baseInput,
			tools: [
				...baseTools,
				{ name: "delete", description: "Delete a record", schema: null },
			],
		});
		expect(a).not.toBe(b);
	});

	it("changes when max_tokens changes", () => {
		const a = fingerprint(baseInput);
		const b = fingerprint({
			...baseInput,
			runtimeConfig: { ...baseInput.runtimeConfig, max_tokens: 2048 },
		});
		expect(a).not.toBe(b);
	});
});
