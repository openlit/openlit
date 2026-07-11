import {
	normalizeOtlpId,
	parseOtlpTrace,
} from "@/lib/platform/datasource/otlp-json";

describe("normalizeOtlpId", () => {
	it("lowercases hex ids", () => {
		expect(normalizeOtlpId("E0B1E39EFD34CE35")).toBe("e0b1e39efd34ce35");
	});

	it("decodes Tempo base64 OTLP ids to hex", () => {
		expect(normalizeOtlpId("4LHjnv00zjU=")).toBe("e0b1e39efd34ce35");
	});
});

describe("parseOtlpTrace", () => {
	it("normalizes base64 span and trace ids to hex", () => {
		const spans = parseOtlpTrace({
			batches: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: Buffer.from("0123456789abcdef0123456789abcdef", "hex").toString(
										"base64"
									),
									spanId: "4LHjnv00zjU=",
									parentSpanId: "",
									name: "chat",
									startTimeUnixNano: "1",
									endTimeUnixNano: "2",
								},
							],
						},
					],
				},
			],
		});
		expect(spans[0].spanId).toBe("e0b1e39efd34ce35");
		expect(spans[0].traceId).toBe("0123456789abcdef0123456789abcdef");
	});
});
