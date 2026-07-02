import { validateControllerConfig } from "@/lib/platform/controller/validate-config";

describe("validateControllerConfig", () => {
	it("preserves the retrieval payload-extraction toggle", () => {
		const config = validateControllerConfig({
			export: {},
			discovery: {},
			payload_extraction: {
				openai: true,
				retrieval: true,
				ollama: false,
			},
		});

		expect(config.payload_extraction.openai).toBe(true);
		expect(config.payload_extraction.retrieval).toBe(true);
		expect(config.payload_extraction.ollama).toBe(false);
		expect(config.payload_extraction.bedrock).toBe(false);
	});
});
