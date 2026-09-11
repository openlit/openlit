/**
 * Resolve Trustabl `scan` flags: per-run overrides, then connector defaults.
 * File-output and attest flags stay out of the in-app job.
 */

import type { ScannerScanInput, ScannerScanParams } from "./types";
import type { ScannerCliSchema } from "./cli-schema";
import {
	BLOCKED_SCAN_FLAGS,
	flagFromKey,
	isScannerExtraSettingKey,
	KNOWN_SCAN_PARAM_KEYS,
	schemaAllowsFlag,
} from "./cli-schema";
import {
	normalizeScannerDetectors,
	normalizeScannerRef,
	normalizeScannerRulesRepo,
	normalizeScannerRulesSource,
} from "./target";

export function settingFlag(settings: Record<string, unknown>, key: string): boolean {
	return settings[key] === true || settings[key] === "true";
}

export function rulesSourceForEnvironment(environment?: string): string {
	const env = String(environment || "production").trim().toLowerCase();
	if (env === "staging") return "staging";
	if (env === "development" || env === "dev") return "git";
	return "production";
}

function optionalBoolean(value: unknown): boolean | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value === "boolean") return value;
	if (value === "true") return true;
	if (value === "false") return false;
	return undefined;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 500) : undefined;
}

function sanitizeExtraValue(value: unknown): string | boolean | undefined {
	const flag = optionalBoolean(value);
	if (flag !== undefined) return flag;
	const text = optionalString(value);
	if (!text) return undefined;
	if (/[\r\n\0]/.test(text) || text.startsWith("-")) return undefined;
	return text;
}

function collectExtras(
	input: Record<string, unknown>,
	settings: Record<string, unknown>
): Record<string, string | boolean> | undefined {
	const extras: Record<string, string | boolean> = {};
	const nested =
		input.extras && typeof input.extras === "object" && !Array.isArray(input.extras)
			? (input.extras as Record<string, unknown>)
			: {};
	for (const source of [settings, input, nested]) {
		for (const [key, value] of Object.entries(source)) {
			if (key === "extras") continue;
			if (!isScannerExtraSettingKey(key)) continue;
			const next = sanitizeExtraValue(value);
			if (next === undefined) continue;
			extras[key] = next;
		}
	}
	return Object.keys(extras).length ? extras : undefined;
}

export function parseScannerScanInput(body: Record<string, unknown>): ScannerScanInput {
	const extras = collectExtras(body, {});
	return {
		target: optionalString(body.target),
		ref: optionalString(body.ref),
		detectors: optionalString(body.detectors),
		strict: optionalBoolean(body.strict),
		secretScan: optionalBoolean(body.secretScan),
		vulnScan: optionalBoolean(body.vulnScan),
		licenseScan: optionalBoolean(body.licenseScan),
		requireSigned: optionalBoolean(body.requireSigned),
		rulesRepo: optionalString(body.rulesRepo),
		rulesRef: optionalString(body.rulesRef),
		rulesSource: optionalString(body.rulesSource),
		noRulesUpdate: optionalBoolean(body.noRulesUpdate),
		verbose: optionalBoolean(body.verbose),
		...(extras ? { extras } : {}),
	};
}

function resolveBoolean(
	input: boolean | undefined,
	settings: Record<string, unknown>,
	key: string,
	fallback = false
): boolean {
	if (typeof input === "boolean") return input;
	if (settings[key] === true || settings[key] === "true") return true;
	if (settings[key] === false || settings[key] === "false") return false;
	return fallback;
}

export function resolveScannerScanParams(
	input: ScannerScanInput,
	settings: Record<string, unknown>,
	environment?: string
): ScannerScanParams {
	const detectors = normalizeScannerDetectors(
		input.detectors !== undefined ? input.detectors : settings.detectors
	);
	const rulesRepo = normalizeScannerRulesRepo(
		input.rulesRepo !== undefined ? input.rulesRepo : settings.rulesRepo
	);
	const rulesRef = normalizeScannerRef(
		input.rulesRef !== undefined ? input.rulesRef : settings.rulesRef
	);
	const explicitSource =
		input.rulesSource !== undefined ? input.rulesSource : settings.rulesSource;
	const rulesSource =
		normalizeScannerRulesSource(explicitSource) || rulesSourceForEnvironment(environment);
	return {
		detectors,
		strict: resolveBoolean(input.strict, settings, "strict"),
		secretScan: resolveBoolean(input.secretScan, settings, "secretScan"),
		vulnScan: resolveBoolean(input.vulnScan, settings, "vulnScan"),
		licenseScan: resolveBoolean(input.licenseScan, settings, "licenseScan"),
		requireSigned: resolveBoolean(input.requireSigned, settings, "requireSigned", true),
		rulesRepo,
		rulesRef,
		rulesSource,
		noRulesUpdate: resolveBoolean(input.noRulesUpdate, settings, "noRulesUpdate"),
		verbose: resolveBoolean(input.verbose, settings, "verbose"),
		extras: collectExtras(input as Record<string, unknown>, settings),
	};
}

export function compactScannerScanParams(params: ScannerScanParams): ScannerScanParams {
	const next: ScannerScanParams = {};
	if (params.detectors) next.detectors = params.detectors;
	if (params.strict) next.strict = true;
	if (params.secretScan) next.secretScan = true;
	if (params.vulnScan) next.vulnScan = true;
	if (params.licenseScan) next.licenseScan = true;
	if (params.requireSigned === false) next.requireSigned = false;
	else if (params.requireSigned) next.requireSigned = true;
	if (params.rulesRepo) next.rulesRepo = params.rulesRepo;
	if (params.rulesRef) next.rulesRef = params.rulesRef;
	if (params.rulesSource) next.rulesSource = params.rulesSource;
	if (params.noRulesUpdate) next.noRulesUpdate = true;
	if (params.verbose) next.verbose = true;
	if (params.extras && Object.keys(params.extras).length) next.extras = params.extras;
	return next;
}

function pushFlag(argv: string[], flag: string, value: string | boolean | undefined, schema?: ScannerCliSchema) {
	if (value === undefined || value === false || value === "") return;
	if (BLOCKED_SCAN_FLAGS.has(flag) || !schemaAllowsFlag(schema, flag)) return;
	if (value === true) {
		argv.push(`--${flag}`);
		return;
	}
	argv.push(`--${flag}`, String(value));
}

export function buildScannerScanArgv(
	target: string,
	params: ScannerScanParams,
	schema?: ScannerCliSchema
): string[] {
	const argv = ["scan", target, "--format", "json", "--no-progress", "--no-color"];
	pushFlag(argv, "detectors", params.detectors, schema);
	pushFlag(argv, "strict", params.strict, schema);
	pushFlag(argv, "secret-scan", params.secretScan, schema);
	pushFlag(argv, "vuln-scan", params.vulnScan, schema);
	pushFlag(argv, "license-scan", params.licenseScan, schema);
	pushFlag(argv, "rules-repo", params.rulesRepo, schema);
	pushFlag(argv, "rules-ref", params.rulesRef, schema);
	pushFlag(argv, "rules-source", params.rulesSource, schema);
	if (params.requireSigned && params.rulesSource !== "git") {
		pushFlag(argv, "require-signed", true, schema);
	}
	pushFlag(argv, "no-rules-update", params.noRulesUpdate, schema);
	pushFlag(argv, "verbose", params.verbose, schema);
	for (const [key, value] of Object.entries(params.extras || {})) {
		if ((KNOWN_SCAN_PARAM_KEYS as readonly string[]).includes(key)) continue;
		pushFlag(argv, flagFromKey(key), value, schema);
	}
	return argv;
}
