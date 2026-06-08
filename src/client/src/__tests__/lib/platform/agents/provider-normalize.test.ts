import {
	canonicalProvider,
	mergeProviders,
} from "@/lib/platform/agents/provider-normalize";

describe("canonicalProvider", () => {
	it("maps OTel semconv names to short controller names", () => {
		expect(canonicalProvider("gcp.gemini")).toBe("gemini");
		expect(canonicalProvider("aws.bedrock")).toBe("bedrock");
		expect(canonicalProvider("azure.ai.openai")).toBe("azure_openai");
	});

	it("passes through already-canonical names", () => {
		expect(canonicalProvider("openai")).toBe("openai");
		expect(canonicalProvider("gemini")).toBe("gemini");
		expect(canonicalProvider("custom")).toBe("custom");
	});

	it("is case- and whitespace-insensitive", () => {
		expect(canonicalProvider("  GCP.Gemini ")).toBe("gemini");
	});

	it("leaves unknown providers (frameworks) untouched", () => {
		expect(canonicalProvider("crewai")).toBe("crewai");
		expect(canonicalProvider("langgraph")).toBe("langgraph");
	});
});

describe("mergeProviders", () => {
	it("collapses the controller vs semconv alias for the same provider", () => {
		// The exact bug: controller reports "gemini", traces report "gcp.gemini".
		expect(mergeProviders(["gcp.gemini"], ["gemini"])).toEqual(["gemini"]);
	});

	it("unions distinct providers and preserves first-seen order", () => {
		expect(mergeProviders(["gcp.gemini"], ["openai"])).toEqual([
			"gemini",
			"openai",
		]);
	});

	it("keeps a framework + its underlying LLM as two entries", () => {
		// crewai (framework) + openai (LLM) are genuinely different — not merged.
		expect(mergeProviders(["crewai"], ["openai"])).toEqual([
			"crewai",
			"openai",
		]);
	});

	it("handles empty/undefined lists and falsy entries", () => {
		expect(mergeProviders(undefined, [])).toEqual([]);
		expect(mergeProviders(["", "openai"], undefined)).toEqual(["openai"]);
	});

	it("dedups within a single list too", () => {
		expect(mergeProviders(["gemini", "gcp.gemini"])).toEqual(["gemini"]);
	});
});
