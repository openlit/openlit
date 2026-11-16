import { samplingFor, supportsSamplingParams } from "@/lib/platform/providers/sampling";

describe("supportsSamplingParams", () => {
	it.each([
		"claude-haiku-5-5",
		"claude-sonnet-5-5",
		"claude-sonnet-5",
		"claude-opus-5-5",
		"claude-opus-5",
		"claude-opus-4-8",
		"claude-opus-4-7",
		"claude-fable-5-2",
		"claude-mythos-5-1",
		"anthropic.claude-opus-5-5",
		"us.anthropic.claude-sonnet-5-5",
		"claude-some-future-model",
		"anthropic/claude-opus-4.7",
		"claude-opus-4.8",
		"claude-sonnet-5.5",
		"claude-5-sonnet",
		"claude-5-5-sonnet",
		"claude-4-7-opus",
	])("rejects sampling for %s", (model) => {
		expect(supportsSamplingParams(model)).toBe(false);
	});

	it.each([
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-sonnet-4-5",
		"claude-haiku-4-5",
		"claude-opus-4-1-20250805",
		"claude-sonnet-4-20250514",
		"claude-sonnet-4-0",
		"claude-3-5-sonnet-latest",
		"claude-3-opus-20240229",
		"claude-2.1",
		"claude-instant-1.2",
		"claude-v2",
		"claude-v1",
		"anthropic.claude-v2:1",
		"anthropic/claude-sonnet-4.5",
		"claude-4-6-sonnet",
		"anthropic.claude-sonnet-4-5-20250929-v1:0",
	])("keeps sampling for %s", (model) => {
		expect(supportsSamplingParams(model)).toBe(true);
	});

	it.each(["gpt-4o", "gemini-2.5-pro", "mistral-large", "llama-3.1-70b"])(
		"leaves non-Claude model %s alone",
		(model) => {
			expect(supportsSamplingParams(model)).toBe(true);
		}
	);

	it("reads the modelId from a language model instance", () => {
		expect(supportsSamplingParams({ modelId: "claude-haiku-5-5" } as any)).toBe(false);
		expect(supportsSamplingParams({ modelId: "gpt-4o" } as any)).toBe(true);
	});
});

describe("samplingFor", () => {
	it("drops sampling settings for models that reject them", () => {
		expect(samplingFor("claude-haiku-5-5", { temperature: 0, topP: 0.9 })).toEqual({});
	});

	it("keeps defined settings and drops undefined ones otherwise", () => {
		expect(samplingFor("gpt-4o", { temperature: 0, topP: undefined })).toEqual({
			temperature: 0,
		});
	});
});
