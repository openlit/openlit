import {
	isScannerEnrichRunId,
	parseScannerEnrichInput,
} from "@/lib/platform/connectors/scanner/enrich-params";
import {
	SCANNER_ENRICH_ATTEMPTS_INVALID,
	SCANNER_ENRICH_FINDING_INVALID,
	SCANNER_ENRICH_MODEL_INVALID,
	SCANNER_ENRICH_PROVIDER_INVALID,
	SCANNER_JOB_ID_INVALID,
	SCANNER_REF_INVALID,
} from "@/constants/messages/en";

const valid = { jobId: "job:abc-123", alertNumber: 4, provider: "anthropic" };

describe("parseScannerEnrichInput", () => {
	it("applies defaults", () => {
		expect(parseScannerEnrichInput(valid)).toEqual({
			jobId: "job:abc-123",
			alertNumber: 4,
			provider: "anthropic",
			model: undefined,
			attempts: 1,
			recheck: true,
			baseRef: undefined,
		});
	});

	it("keeps explicit options", () => {
		expect(
			parseScannerEnrichInput({
				...valid,
				provider: "google",
				model: " gemini-2.5-pro ",
				attempts: 2,
				recheck: false,
				baseRef: "release/1.2",
			})
		).toEqual({
			jobId: "job:abc-123",
			alertNumber: 4,
			provider: "google",
			model: "gemini-2.5-pro",
			attempts: 2,
			recheck: false,
			baseRef: "release/1.2",
		});
	});

	it("treats an empty model as the Trustabl default", () => {
		expect(parseScannerEnrichInput({ ...valid, model: "" }).model).toBeUndefined();
	});

	it.each([
		[{ ...valid, jobId: "nope" }, SCANNER_JOB_ID_INVALID],
		[{ ...valid, alertNumber: 0 }, SCANNER_ENRICH_FINDING_INVALID],
		[{ ...valid, alertNumber: 1.5 }, SCANNER_ENRICH_FINDING_INVALID],
		[{ ...valid, alertNumber: "4" }, SCANNER_ENRICH_FINDING_INVALID],
		[{ ...valid, alertNumber: 10_001 }, SCANNER_ENRICH_FINDING_INVALID],
		[{ ...valid, provider: "mistral" }, SCANNER_ENRICH_PROVIDER_INVALID],
		[{ ...valid, model: "gpt 4; rm -rf" }, SCANNER_ENRICH_MODEL_INVALID],
		[{ ...valid, model: "x".repeat(101) }, SCANNER_ENRICH_MODEL_INVALID],
		[{ ...valid, attempts: 3 }, SCANNER_ENRICH_ATTEMPTS_INVALID],
		[{ ...valid, attempts: 0 }, SCANNER_ENRICH_ATTEMPTS_INVALID],
		[{ ...valid, baseRef: "main; id" }, SCANNER_REF_INVALID],
	])("rejects %p", (body, message) => {
		expect(() => parseScannerEnrichInput(body as Record<string, unknown>)).toThrow(message);
	});
});

describe("isScannerEnrichRunId", () => {
	it("accepts enrich run ids only", () => {
		expect(isScannerEnrichRunId("enrich:4f0e-a1")).toBe(true);
		expect(isScannerEnrichRunId("job:4f0e")).toBe(false);
		expect(isScannerEnrichRunId("enrich:../x")).toBe(false);
	});
});
