/**
 * Resolve Trustabl `forge` flags. Forge reads policies instead of cloning the
 * repository, and writes SKILL.md to stdout, so no output path is ever passed.
 */

import {
	BLOCKED_FORGE_FLAGS,
	flagFromKey,
	type ScannerForgeSchema,
} from "./cli-schema";
import { normalizeScannerRef } from "./target";
import type { ScannerForgeParams, ScannerForgeRunInput } from "./types";
import {
	SCANNER_FORGE_FILE_NAME_INVALID,
	SCANNER_FORGE_POLICY_INVALID,
} from "@/constants/messages/en";

export const FORGE_DEFAULT_FILE_NAME = "SKILL.md";
const MAX_POLICIES = 32;
const POLICY_ID = /^[a-z][a-z0-9_]{0,62}$/;
const FILE_NAME = /^[A-Za-z0-9._-]{1,100}\.md$/;
const EXTRA_KEY = /^[a-z][a-zA-Z0-9]{0,63}$/;
/** Flags OpenLIT can pass before the CLI schema is known. */
const FALLBACK_FORGE_FLAGS = new Set(["rules-ref"]);

export function normalizeForgePolicies(value: unknown): string[] {
	if (value == null || value === "") return [];
	const raw = Array.isArray(value) ? value : String(value).split(",");
	const policies: string[] = [];
	for (const item of raw) {
		const policy = String(item ?? "").trim().toLowerCase();
		if (!policy) continue;
		if (!POLICY_ID.test(policy)) throw new Error(SCANNER_FORGE_POLICY_INVALID);
		if (!policies.includes(policy)) policies.push(policy);
	}
	if (policies.length > MAX_POLICIES) throw new Error(SCANNER_FORGE_POLICY_INVALID);
	return policies;
}

export function normalizeForgeFileName(value: unknown): string {
	const name = String(value ?? "").trim();
	if (!name) return FORGE_DEFAULT_FILE_NAME;
	if (!FILE_NAME.test(name) || name.startsWith(".")) {
		throw new Error(SCANNER_FORGE_FILE_NAME_INVALID);
	}
	return name;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 500) : undefined;
}

function parseExtras(value: unknown): Record<string, string | boolean> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const extras: Record<string, string | boolean> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!EXTRA_KEY.test(key) || BLOCKED_FORGE_FLAGS.has(flagFromKey(key))) continue;
		if (typeof raw === "boolean") {
			extras[key] = raw;
			continue;
		}
		const text = optionalString(raw);
		if (!text || /[\r\n\0]/.test(text) || text.startsWith("-")) continue;
		extras[key] = text;
	}
	return Object.keys(extras).length ? extras : undefined;
}

/** Shape a request body. Values are validated again when the run is resolved. */
export function parseScannerForgeInput(body: Record<string, unknown>): ScannerForgeRunInput {
	const input: ScannerForgeRunInput = {};
	const target = optionalString(body.target);
	if (target) input.target = target;
	if (body.policies !== undefined && body.policies !== null && body.policies !== "") {
		input.policies = normalizeForgePolicies(body.policies);
	}
	const rulesRef = optionalString(body.rulesRef);
	if (rulesRef) input.rulesRef = rulesRef;
	const fileName = optionalString(body.fileName);
	if (fileName) input.fileName = fileName;
	const sourceJobId = optionalString(body.sourceJobId);
	if (sourceJobId) input.sourceJobId = sourceJobId;
	const extras = parseExtras(body.extras);
	if (extras) input.extras = extras;
	return input;
}

/** Validate run params; throws with a user-facing message. */
export function resolveScannerForgeParams(input: ScannerForgeRunInput): ScannerForgeParams {
	return {
		policies: normalizeForgePolicies(input.policies),
		rulesRef: normalizeScannerRef(input.rulesRef),
		fileName: normalizeForgeFileName(input.fileName),
		extras: parseExtras(input.extras),
	};
}

function allowsFlag(schema: ScannerForgeSchema | undefined, flag: string): boolean {
	if (BLOCKED_FORGE_FLAGS.has(flag)) return false;
	if (!schema?.flags.length) return FALLBACK_FORGE_FLAGS.has(flag);
	return schema.flags.some((item) => item.flag === flag);
}

function pushFlag(
	argv: string[],
	flag: string,
	value: string | boolean | undefined,
	schema?: ScannerForgeSchema
) {
	if (value === undefined || value === false || value === "") return;
	if (!allowsFlag(schema, flag)) return;
	if (value === true) {
		argv.push(`--${flag}`);
		return;
	}
	argv.push(`--${flag}`, String(value));
}

export function buildScannerForgeArgv(
	params: ScannerForgeParams,
	schema?: ScannerForgeSchema
): string[] {
	const argv = ["forge", "--policy", params.policies.join(",")];
	pushFlag(argv, "rules-ref", params.rulesRef, schema);
	for (const [key, value] of Object.entries(params.extras || {})) {
		const flag = flagFromKey(key);
		if (flag === "rules-ref") continue;
		pushFlag(argv, flag, value, schema);
	}
	return argv;
}

export function forgeCommandPreview(argv: string[]): string {
	return ["trustabl", ...argv].join(" ");
}
