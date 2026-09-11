/**
 * Trustabl CLI scan-flag schema.
 *
 * OpenLIT introspects `trustabl scan --help` after install/upgrade so the
 * connector form and run-params dialog match the binary on disk instead of a
 * compiled-in flag list.
 */

export type ScannerFlagKind = "boolean" | "string";

export type ScannerFlagGroup = "scan" | "rules";

export interface ScannerCliFlag {
	flag: string;
	key: string;
	kind: ScannerFlagKind;
	group: ScannerFlagGroup;
	help: string;
	defaultValue?: string | boolean;
}

export interface ScannerCliSchema {
	version?: string;
	flags: ScannerCliFlag[];
}

const VALUE_TYPES = new Set([
	"string",
	"strings",
	"stringarray",
	"stringtostring",
	"int",
	"int8",
	"int16",
	"int32",
	"int64",
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"float",
	"float32",
	"float64",
	"duration",
	"count",
	"bytes",
	"ip",
	"ipmask",
]);

/** Flags OpenLIT always controls or must never take from the UI. */
export const BLOCKED_SCAN_FLAGS = new Set([
	"help",
	"format",
	"output",
	"json-out",
	"sarif-out",
	"bom-out",
	"no-progress",
	"no-color",
	"attest",
	"attest-key",
	"attest-bundle",
	"attest-no-tlog",
	"debug",
]);

/** Deprecated aliases hidden when the replacement flag exists. */
const HIDDEN_SCAN_FLAGS = new Set(["channel"]);

const RULES_FLAGS = new Set([
	"rules-repo",
	"rules-ref",
	"rules-source",
	"require-signed",
	"no-rules-update",
	"channel",
]);

export const KNOWN_SCAN_PARAM_KEYS = [
	"detectors",
	"strict",
	"secretScan",
	"vulnScan",
	"licenseScan",
	"requireSigned",
	"rulesRepo",
	"rulesRef",
	"rulesSource",
	"noRulesUpdate",
	"verbose",
] as const;

export const SCANNER_OWNED_SETTING_KEYS = new Set([
	"target",
	"ref",
	"githubToken",
	"token",
]);

const FLAG_PREFIX = /^(?:-[A-Za-z0-9],\s+)?--([a-z0-9-]+)(?:\s+(\S+))?\s+(.*)$/;
const CONTINUATION = /^\s{8,}(\S.*)$/;
const DEFAULT_TRUE = /\(default true\)\s*$/i;
const DEFAULT_FALSE = /\(default false\)\s*$/i;
const DEFAULT_QUOTED = /\(default "([^"]*)"\)\s*$/i;
const DEFAULT_BARE = /\(default ([^)]+)\)\s*$/i;

export function keyFromFlag(flag: string): string {
	return String(flag || "").replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

export function flagFromKey(key: string): string {
	return String(key || "").replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

export function humanizeScannerFlag(flag: string): string {
	return String(flag || "")
		.split("-")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function stripDefault(help: string): string {
	return help
		.replace(DEFAULT_QUOTED, "")
		.replace(DEFAULT_TRUE, "")
		.replace(DEFAULT_FALSE, "")
		.replace(DEFAULT_BARE, "")
		.trim();
}

function parseDefault(help: string, kind: ScannerFlagKind): string | boolean | undefined {
	if (kind === "boolean") {
		if (DEFAULT_TRUE.test(help)) return true;
		if (DEFAULT_FALSE.test(help)) return false;
		return undefined;
	}
	const quoted = help.match(DEFAULT_QUOTED);
	if (quoted) return quoted[1];
	const bare = help.match(DEFAULT_BARE);
	if (!bare) return undefined;
	const value = bare[1].trim();
	if (/^(true|false)$/i.test(value)) return undefined;
	return value;
}

function flagGroup(flag: string): ScannerFlagGroup {
	return RULES_FLAGS.has(flag) ? "rules" : "scan";
}

function isValueType(token: string | undefined): boolean {
	return Boolean(token && VALUE_TYPES.has(token.toLowerCase()));
}

export function parseTrustablScanHelp(text: string): ScannerCliFlag[] {
	const flags: ScannerCliFlag[] = [];
	const seen = new Set<string>();
	let current: ScannerCliFlag | null = null;
	for (const raw of String(text || "").split(/\r?\n/)) {
		const line = raw.replace(/\t/g, "    ");
		const match = line.trim().match(FLAG_PREFIX);
		if (match) {
			const flag = match[1];
			let typeToken = match[2];
			let rest = match[3] || "";
			if (typeToken && !isValueType(typeToken)) {
				rest = `${typeToken} ${rest}`.trim();
				typeToken = undefined;
			}
			const kind: ScannerFlagKind = isValueType(typeToken) ? "string" : "boolean";
			const help = rest;
			current = {
				flag,
				key: keyFromFlag(flag),
				kind,
				group: flagGroup(flag),
				help: stripDefault(help),
				defaultValue: parseDefault(help, kind),
			};
			if (!seen.has(flag) && !BLOCKED_SCAN_FLAGS.has(flag)) {
				seen.add(flag);
				flags.push(current);
			} else {
				current = null;
			}
			continue;
		}
		const cont = line.match(CONTINUATION);
		if (cont && current) {
			current.help = stripDefault(`${current.help} ${cont[1]}`.trim());
		}
	}
	const hasRulesSource = flags.some((item) => item.flag === "rules-source");
	return flags.filter((item) => !(HIDDEN_SCAN_FLAGS.has(item.flag) && hasRulesSource));
}

export function scannerCliSchemaFromHelp(text: string, version?: string): ScannerCliSchema {
	return {
		version,
		flags: parseTrustablScanHelp(text),
	};
}

export function schemaAllowsFlag(schema: ScannerCliSchema | undefined, flag: string): boolean {
	if (!schema?.flags.length) {
		return (KNOWN_SCAN_PARAM_KEYS as readonly string[]).some((key) => flagFromKey(key) === flag);
	}
	return schema.flags.some((item) => item.flag === flag);
}

export function isScannerExtraSettingKey(key: string): boolean {
	if (!/^[a-z][a-zA-Z0-9]{0,63}$/.test(key)) return false;
	if (SCANNER_OWNED_SETTING_KEYS.has(key)) return false;
	if ((KNOWN_SCAN_PARAM_KEYS as readonly string[]).includes(key)) return false;
	const flag = flagFromKey(key);
	return !BLOCKED_SCAN_FLAGS.has(flag) && !HIDDEN_SCAN_FLAGS.has(flag);
}

export function overlayScannerConfigFields<T extends { type: string; configFields?: unknown }>(
	types: T[],
	configFields: unknown[] | undefined,
	scannerType = "trustabl"
): T[] {
	if (!configFields?.length) return types;
	return types.map((item) =>
		item.type === scannerType ? { ...item, configFields } : item
	);
}
