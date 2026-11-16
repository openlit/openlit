jest.mock("@/lib/platform/vault", () => ({ getSecrets: jest.fn() }));

import { getSecrets } from "@/lib/platform/vault";
import {
	listScannerEnrichProviders,
	resolveScannerEnrichProviderKey,
	scannerEnrichModels,
	SCANNER_ENRICH_PROVIDERS,
} from "@/lib/platform/connectors/scanner/enrich-providers";
import { SCANNER_ENRICH_KEY_MISSING } from "@/constants/messages/en";

const mockGetSecrets = getSecrets as jest.Mock;

describe("enrich providers", () => {
	beforeEach(() => mockGetSecrets.mockReset());

	it("maps each provider to the env key Trustabl reads", () => {
		expect(SCANNER_ENRICH_PROVIDERS.map((provider) => [provider.id, provider.envKey])).toEqual([
			["anthropic", "ANTHROPIC_API_KEY"],
			["openai", "OPENAI_API_KEY"],
			["google", "GOOGLE_API_KEY"],
		]);
	});

	it("lists chat models from the OpenLIT catalog", () => {
		expect(scannerEnrichModels("anthropic")).toContain("claude-haiku-4-5");
		expect(scannerEnrichModels("openai").some((model) => model.includes("embedding"))).toBe(false);
		expect(scannerEnrichModels("unknown" as never)).toEqual([]);
	});

	it("reports which keys exist without reading values", async () => {
		mockGetSecrets.mockImplementation(async ({ key }: { key: string }) => ({
			data: key === "ANTHROPIC_API_KEY" ? [{ id: "s1", key }] : [],
		}));
		const providers = await listScannerEnrichProviders();
		expect(providers.map((provider) => [provider.id, provider.hasKey])).toEqual([
			["anthropic", true],
			["openai", false],
			["google", false],
		]);
		expect(mockGetSecrets).toHaveBeenCalledWith({ key: "ANTHROPIC_API_KEY" });
		expect(JSON.stringify(providers)).not.toContain("value");
	});

	it("treats an unreachable Vault as no key", async () => {
		mockGetSecrets.mockRejectedValueOnce(new Error("clickhouse down"));
		mockGetSecrets.mockResolvedValue({ err: "query failed" });
		const providers = await listScannerEnrichProviders();
		expect(providers.every((provider) => provider.hasKey === false)).toBe(true);
	});

	it("resolves the key value for a run", async () => {
		mockGetSecrets.mockResolvedValue({ data: [{ key: "OPENAI_API_KEY", value: " sk-test-value " }] });
		await expect(resolveScannerEnrichProviderKey("openai")).resolves.toBe("sk-test-value");
		expect(mockGetSecrets).toHaveBeenCalledWith({ key: "OPENAI_API_KEY" }, { selectValue: true });
	});

	it("names the missing key", async () => {
		mockGetSecrets.mockResolvedValue({ data: [] });
		await expect(resolveScannerEnrichProviderKey("google")).rejects.toThrow(
			SCANNER_ENRICH_KEY_MISSING("GOOGLE_API_KEY")
		);
	});
});
