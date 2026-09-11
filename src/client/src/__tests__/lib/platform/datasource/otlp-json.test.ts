import {
	normalizeOtlpId,
	parseOtlpTrace,
} from "@/lib/platform/connectors/datasource/otlp-json";

describe("normalizeOtlpId", () => {
	it("lowercases hex ids", () => {
		expect(normalizeOtlpId("E0B1E39EFD34CE35")).toBe("e0b1e39efd34ce35");
	});

	it("decodes Tempo base64 OTLP ids to hex", () => {
		expect(normalizeOtlpId("4LHjnv00zjU=")).toBe("e0b1e39efd34ce35");
	});

	it("returns empty string for undefined/empty input", () => {
		expect(normalizeOtlpId(undefined)).toBe("");
		expect(normalizeOtlpId("")).toBe("");
		expect(normalizeOtlpId("   ")).toBe("");
	});

	it("trims surrounding whitespace before evaluating", () => {
		expect(normalizeOtlpId("  E0B1E39EFD34CE35  ")).toBe("e0b1e39efd34ce35");
	});

	it("does not treat odd-length hex-looking strings as hex", () => {
		// Odd length fails the hex fast-path, falls through to base64 decode.
		const value = "abc";
		const decoded = Buffer.from(value, "base64");
		expect([8, 16]).not.toContain(decoded.length);
		expect(normalizeOtlpId(value)).toBe(value);
	});

	it("returns the original value unchanged when base64-decoded length is not 8 or 16 bytes", () => {
		// "not-hex!!" decodes to some arbitrary byte length that is not 8/16.
		const value = "not-hex!!";
		expect(normalizeOtlpId(value)).toBe(value);
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

	it("handles a nested `trace` wrapper and `resourceSpans`/`instrumentationLibrarySpans` shapes", () => {
		const spans = parseOtlpTrace({
			trace: {
				resourceSpans: [
					{
						resource: {
							attributes: [{ key: "service.name", value: { stringValue: "svc-a" } }],
						},
						instrumentationLibrarySpans: [
							{
								spans: [
									{
										traceId: "0123456789abcdef0123456789abcdef",
										spanId: "0123456789abcdef",
										name: "op",
									},
								],
							},
						],
					},
				],
			},
		});
		expect(spans).toHaveLength(1);
		expect(spans[0].serviceName).toBe("svc-a");
		expect(spans[0].name).toBe("op");
	});

	it("returns [] for an empty/unrecognized payload", () => {
		expect(parseOtlpTrace({})).toEqual([]);
		expect(parseOtlpTrace(null)).toEqual([]);
		expect(parseOtlpTrace(undefined)).toEqual([]);
	});

	it("defaults missing resource/scope/span arrays to empty and missing span name to ''", () => {
		const spans = parseOtlpTrace({
			batches: [{}, { resource: {}, scopeSpans: [{}] }],
		});
		expect(spans).toEqual([]);
	});

	it("normalizes every OTLP AnyValue kind and skips key-less attributes", () => {
		const spans = parseOtlpTrace({
			batches: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: "0123456789abcdef0123456789abcdef",
									spanId: "0123456789abcdef",
									name: "attrs",
									attributes: [
										{ key: "str.attr", value: { stringValue: "hello" } },
										{ key: "int.attr", value: { intValue: 42 } },
										{ key: "int.str.attr", value: { intValue: "42" } },
										{ key: "double.attr", value: { doubleValue: 1.5 } },
										{ key: "bool.attr", value: { boolValue: true } },
										{
											key: "array.attr",
											value: {
												arrayValue: {
													values: [{ stringValue: "a" }, { stringValue: "b" }],
												},
											},
										},
										{ key: "empty.attr" },
										{ key: "unknown.kind.attr", value: {} },
										{ value: { stringValue: "no-key" } } as any,
									],
								},
							],
						},
					],
				},
			],
		});
		expect(spans[0].spanAttributes).toEqual({
			"str.attr": "hello",
			"int.attr": "42",
			"int.str.attr": "42",
			"double.attr": "1.5",
			"bool.attr": "true",
			"array.attr": JSON.stringify(["a", "b"]),
			"empty.attr": "",
			"unknown.kind.attr": "",
		});
	});

	it("maps numeric and string OTLP status codes, defaulting unset/unknown to their string form", () => {
		const build = (code?: string | number) =>
			parseOtlpTrace({
				batches: [
					{
						resource: { attributes: [] },
						scopeSpans: [
							{
								spans: [
									{
										traceId: "0123456789abcdef0123456789abcdef",
										spanId: "0123456789abcdef",
										name: "s",
										status: code === undefined ? undefined : { code, message: "m" },
									},
								],
							},
						],
					},
				],
			})[0];

		expect(build(2).statusCode).toBe("STATUS_CODE_ERROR");
		expect(build("ERROR").statusCode).toBe("STATUS_CODE_ERROR");
		expect(build("STATUS_CODE_ERROR").statusCode).toBe("STATUS_CODE_ERROR");
		expect(build(1).statusCode).toBe("STATUS_CODE_OK");
		expect(build("OK").statusCode).toBe("STATUS_CODE_OK");
		expect(build("STATUS_CODE_OK").statusCode).toBe("STATUS_CODE_OK");
		expect(build(0).statusCode).toBe("0");
		expect(build(undefined).statusCode).toBe("");
		expect(build(undefined).statusMessage).toBeUndefined();
		expect(build(2).statusMessage).toBe("m");
	});

	it("computes duration as 0 when start/end timestamps are missing or non-numeric", () => {
		const spans = parseOtlpTrace({
			batches: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							spans: [
								{ traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef", name: "no-times" },
								{
									traceId: "0123456789abcdef0123456789abcdef",
									spanId: "0123456789abcdef",
									name: "bad-times",
									startTimeUnixNano: "not-a-number",
									endTimeUnixNano: "2",
								},
							],
						},
					],
				},
			],
		});
		expect(spans[0].durationNs).toBe(0);
		expect(spans[0].timestamp).toBe("");
		expect(spans[1].durationNs).toBe(0);
	});

	it("normalizes span events including the timeUnixNano-falsy branch", () => {
		const spans = parseOtlpTrace({
			batches: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: "0123456789abcdef0123456789abcdef",
									spanId: "0123456789abcdef",
									name: "with-events",
									events: [
										{ name: "ev1", timeUnixNano: "1000000", attributes: [{ key: "a", value: { stringValue: "1" } }] },
										{ timeUnixNano: 0 },
										{},
									],
								},
							],
						},
					],
				},
			],
		});
		expect(spans[0].events).toEqual([
			{ name: "ev1", timestamp: "1970-01-01T00:00:00.001Z", attributes: { a: "1" } },
			{ name: "", timestamp: undefined, attributes: {} },
			{ name: "", timestamp: undefined, attributes: {} },
		]);
	});

	it("stringifies numeric span.kind and preserves undefined when absent", () => {
		const withKind = parseOtlpTrace({
			batches: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							spans: [
								{
									traceId: "0123456789abcdef0123456789abcdef",
									spanId: "0123456789abcdef",
									name: "k",
									kind: 2,
								},
							],
						},
					],
				},
			],
		});
		expect(withKind[0].spanKind).toBe("2");

		const withoutKind = parseOtlpTrace({
			batches: [
				{
					resource: { attributes: [] },
					scopeSpans: [
						{
							spans: [
								{ traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef", name: "no-kind" },
							],
						},
					],
				},
			],
		});
		expect(withoutKind[0].spanKind).toBeUndefined();
	});
});
