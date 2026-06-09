import type {
	ControllerConfig,
	ExportConfig,
	DiscoveryConfig,
	PayloadExtractionConfig,
} from "@/types/controller";

// Controller config is fetched by every controller instance and then EXECUTED
// by it (export endpoints, payload extractors, custom hosts, sdk_version). It is
// writable by any authenticated dashboard user, so we validate + sanitize it at
// the API ingress before persisting — a malformed or hostile config must never
// reach a poller. This mirrors the controller-side validation (defense in depth)
// and keeps the stored blob to a known, bounded shape.

const MAX_STR = 2048;
const MAX_HOSTS = 256;
const MAX_TARGETS = 512;
const MAX_HEADERS = 64;

// Same safe version grammar the controller enforces (PEP 440-ish): forbids
// whitespace/quotes/;|&$ etc. so it can never break out of a pip install arg.
const SDK_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

// C0 control characters + DEL. Stripped from every persisted string so they
// cannot corrupt downstream queries/storage or inject into env/unit files.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/g;

export class ConfigValidationError extends Error {}

function str(v: unknown, field: string): string {
	if (typeof v !== "string") {
		throw new ConfigValidationError(`${field} must be a string`);
	}
	if (v.length > MAX_STR) {
		throw new ConfigValidationError(`${field} exceeds ${MAX_STR} chars`);
	}
	return v.replace(CONTROL_CHARS_RE, "");
}

function optStr(v: unknown, field: string): string | undefined {
	if (v === undefined || v === null) return undefined;
	return str(v, field);
}

function bool(v: unknown): boolean {
	return v === true;
}

function sanitizeExport(raw: unknown): ExportConfig {
	const e = (raw ?? {}) as Record<string, unknown>;
	const headersRaw = (e.otlp_headers ?? {}) as Record<string, unknown>;
	const headers: Record<string, string> = {};
	for (const k of Object.keys(headersRaw).slice(0, MAX_HEADERS)) {
		headers[str(k, "otlp_headers key")] = str(headersRaw[k], `otlp_headers[${k}]`);
	}
	return {
		otlp_endpoint: optStr(e.otlp_endpoint, "export.otlp_endpoint") ?? "",
		otlp_headers: headers,
		otlp_protocol: optStr(e.otlp_protocol, "export.otlp_protocol") ?? "",
		otlp_traces_endpoint: optStr(e.otlp_traces_endpoint, "export.otlp_traces_endpoint"),
		otlp_metrics_endpoint: optStr(e.otlp_metrics_endpoint, "export.otlp_metrics_endpoint"),
		otlp_logs_endpoint: optStr(e.otlp_logs_endpoint, "export.otlp_logs_endpoint"),
	};
}

function sanitizeTargets(arr: unknown, field: string) {
	return (Array.isArray(arr) ? arr : []).slice(0, MAX_TARGETS).map((t) => {
		const o = (t ?? {}) as Record<string, unknown>;
		return {
			service_name: optStr(o.service_name, `${field}.service_name`),
			open_ports: optStr(o.open_ports, `${field}.open_ports`),
			exe_path: optStr(o.exe_path, `${field}.exe_path`),
			cmd_args: optStr(o.cmd_args, `${field}.cmd_args`),
		};
	});
}

function sanitizeK8sSelectors(arr: unknown) {
	return (Array.isArray(arr) ? arr : []).slice(0, MAX_TARGETS).map((s) => {
		const o = (s ?? {}) as Record<string, unknown>;
		return {
			namespace: optStr(o.namespace, "k8s.namespace"),
			deployment_name: optStr(o.deployment_name, "k8s.deployment_name"),
		};
	});
}

function sanitizeDiscovery(raw: unknown): DiscoveryConfig {
	const d = (raw ?? {}) as Record<string, unknown>;
	const k8s = d.kubernetes as Record<string, unknown> | undefined;
	return {
		auto_discover: bool(d.auto_discover),
		instrument: sanitizeTargets(d.instrument, "discovery.instrument"),
		exclude: sanitizeTargets(d.exclude, "discovery.exclude"),
		kubernetes: k8s
			? {
					enabled: optStr(k8s.enabled, "kubernetes.enabled") ?? "",
					instrument: sanitizeK8sSelectors(k8s.instrument),
					exclude: sanitizeK8sSelectors(k8s.exclude),
				}
			: undefined,
	};
}

function sanitizePayloadExtraction(raw: unknown): PayloadExtractionConfig {
	const p = (raw ?? {}) as Record<string, unknown>;
	return {
		openai: bool(p.openai),
		anthropic: bool(p.anthropic),
		gemini: bool(p.gemini),
		qwen: bool(p.qwen),
		bedrock: bool(p.bedrock),
		custom: bool(p.custom),
		ollama: bool(p.ollama),
	};
}

/**
 * validateControllerConfig sanitizes an untrusted ControllerConfig payload into
 * a known, bounded shape. Throws ConfigValidationError on anything invalid.
 */
export function validateControllerConfig(raw: unknown): ControllerConfig {
	if (!raw || typeof raw !== "object") {
		throw new ConfigValidationError("config must be an object");
	}
	const c = raw as Record<string, unknown>;

	const customHosts = (Array.isArray(c.custom_llm_hosts) ? c.custom_llm_hosts : [])
		.slice(0, MAX_HOSTS)
		.map((h) => str(h, "custom_llm_hosts entry").trim())
		.filter(Boolean);

	let pollInterval: number | undefined;
	if (c.poll_interval_seconds !== undefined && c.poll_interval_seconds !== null) {
		const n = Number(c.poll_interval_seconds);
		if (!Number.isFinite(n) || n < 5 || n > 300) {
			throw new ConfigValidationError(
				"poll_interval_seconds must be a number between 5 and 300"
			);
		}
		pollInterval = Math.floor(n);
	}

	// sdk_version is not part of ControllerConfig but may ride along on some
	// payloads; if present, enforce the safe grammar here too.
	const sdkVersion = (c as Record<string, unknown>).sdk_version;
	if (typeof sdkVersion === "string" && sdkVersion !== "" && !SDK_VERSION_RE.test(sdkVersion)) {
		throw new ConfigValidationError("sdk_version is not a valid version string");
	}

	return {
		export: sanitizeExport(c.export),
		discovery: sanitizeDiscovery(c.discovery),
		payload_extraction: sanitizePayloadExtraction(c.payload_extraction),
		custom_llm_hosts: customHosts,
		environment: optStr(c.environment, "environment"),
		poll_interval_seconds: pollInterval,
	};
}
