import {
	ConfigValidationError,
	validateControllerConfig,
} from "@/lib/platform/controller/validate-config";

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

	it("rejects non-object configs", () => {
		expect(() => validateControllerConfig(null)).toThrow(ConfigValidationError);
		expect(() => validateControllerConfig("bad")).toThrow(/must be an object/);
	});

	it("sanitizes export headers, optional endpoints, and control chars", () => {
		const config = validateControllerConfig({
			export: {
				otlp_endpoint: "http://collector\x00",
				otlp_protocol: "http/protobuf",
				otlp_headers: {
					Authorization: "Bearer x\x1f",
					"x-extra": "1",
				},
				otlp_traces_endpoint: null,
				otlp_metrics_endpoint: "http://metrics",
				otlp_logs_endpoint: undefined,
			},
			discovery: {},
			payload_extraction: {},
		});

		expect(config.export.otlp_endpoint).toBe("http://collector");
		expect(config.export.otlp_headers.Authorization).toBe("Bearer x");
		expect(config.export.otlp_traces_endpoint).toBeUndefined();
		expect(config.export.otlp_metrics_endpoint).toBe("http://metrics");
		expect(config.export.otlp_logs_endpoint).toBeUndefined();
	});

	it("rejects oversized strings and non-string header values", () => {
		expect(() =>
			validateControllerConfig({
				export: { otlp_endpoint: "x".repeat(2049) },
				discovery: {},
				payload_extraction: {},
			})
		).toThrow(/exceeds 2048/);

		expect(() =>
			validateControllerConfig({
				export: { otlp_headers: { ok: 1 as any } },
				discovery: {},
				payload_extraction: {},
			})
		).toThrow(/must be a string/);
	});

	it("handles null discovery targets and non-array k8s selectors", () => {
		const config = validateControllerConfig({
			export: {},
			discovery: {
				auto_discover: true,
				instrument: [null, undefined, { service_name: "svc", open_ports: "80" }],
				exclude: "not-an-array",
				kubernetes: {
					// enabled omitted → ""
					instrument: "not-array",
					exclude: [null, { namespace: "ns", deployment_name: "dep" }],
				},
			},
			payload_extraction: {},
			custom_llm_hosts: [" host.a ", "", "host.b"],
			environment: "prod",
			poll_interval_seconds: 30.9,
		});

		expect(config.discovery.auto_discover).toBe(true);
		expect(config.discovery.instrument[0]).toEqual({
			service_name: undefined,
			open_ports: undefined,
			exe_path: undefined,
			cmd_args: undefined,
		});
		expect(config.discovery.instrument[2].service_name).toBe("svc");
		expect(config.discovery.exclude).toEqual([]);
		expect(config.discovery.kubernetes).toEqual({
			enabled: "",
			instrument: [],
			exclude: [
				{
					namespace: undefined,
					deployment_name: undefined,
				},
				{ namespace: "ns", deployment_name: "dep" },
			],
		});
		expect(config.custom_llm_hosts).toEqual(["host.a", "host.b"]);
		expect(config.environment).toBe("prod");
		expect(config.poll_interval_seconds).toBe(30);
	});

	it("rejects invalid poll intervals and sdk_version grammar", () => {
		expect(() =>
			validateControllerConfig({
				export: {},
				discovery: {},
				payload_extraction: {},
				poll_interval_seconds: 4,
			})
		).toThrow(/poll_interval_seconds/);

		expect(() =>
			validateControllerConfig({
				export: {},
				discovery: {},
				payload_extraction: {},
				poll_interval_seconds: Number.NaN,
			})
		).toThrow(/poll_interval_seconds/);

		expect(() =>
			validateControllerConfig({
				export: {},
				discovery: {},
				payload_extraction: {},
				sdk_version: "1.2.3; rm -rf /",
			})
		).toThrow(/sdk_version/);

		const ok = validateControllerConfig({
			export: {},
			discovery: {},
			payload_extraction: {},
			sdk_version: "",
			poll_interval_seconds: null,
		});
		expect(ok.poll_interval_seconds).toBeUndefined();
	});

	it("defaults discovery/export when missing and treats false-y bools as false", () => {
		const config = validateControllerConfig({
			payload_extraction: {
				openai: false,
				anthropic: "yes",
				gemini: 1,
				qwen: true,
			},
		});

		expect(config.export.otlp_endpoint).toBe("");
		expect(config.discovery.auto_discover).toBe(false);
		expect(config.payload_extraction).toEqual({
			openai: false,
			anthropic: false,
			gemini: false,
			qwen: true,
			bedrock: false,
			retrieval: false,
			custom: false,
			ollama: false,
		});
	});
});
