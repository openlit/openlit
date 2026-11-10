import getMessage from "@/constants/messages";
import type { FieldDef } from "../datasource/types";
import type { ScannerCliSchema } from "./cli-schema";

function rulesSourceOptions(messages: ReturnType<typeof getMessage>): FieldDef["options"] {
	return [
		{ value: "environment", label: messages.SCANNER_FIELD_RULES_SOURCE_ENVIRONMENT },
		{ value: "production", label: messages.SCANNER_FIELD_RULES_SOURCE_PRODUCTION },
		{ value: "staging", label: messages.SCANNER_FIELD_RULES_SOURCE_STAGING },
		{ value: "git", label: messages.SCANNER_FIELD_RULES_SOURCE_GIT },
	];
}

function ownedFields(messages: ReturnType<typeof getMessage>): FieldDef[] {
	return [
		{
			key: "target",
			label: messages.SCANNER_FIELD_TARGET,
			kind: "url",
			group: "settings",
			placeholder: "https://github.com/owner/repo/tree/main",
			description: messages.SCANNER_FIELD_TARGET_HELP,
		},
		{
			key: "ref",
			label: messages.SCANNER_FIELD_REF,
			kind: "text",
			group: "settings",
			placeholder: "main",
			description: messages.SCANNER_FIELD_REF_HELP,
		},
	];
}

function credentialFields(messages: ReturnType<typeof getMessage>): FieldDef[] {
	return [
		{
			key: "githubToken",
			label: messages.SCANNER_FIELD_GITHUB_TOKEN,
			kind: "password",
			group: "credentials",
		},
	];
}

function knownFlagField(
	key: string,
	messages: ReturnType<typeof getMessage>
): FieldDef | null {
	switch (key) {
		case "detectors":
			return {
				key,
				label: messages.SCANNER_FIELD_DETECTORS,
				kind: "text",
				group: "settings",
				placeholder: "claude_sdk,mcp",
				description: messages.SCANNER_FIELD_DETECTORS_HELP,
			};
		case "strict":
			return {
				key,
				label: messages.SCANNER_FIELD_STRICT,
				kind: "switch",
				group: "settings",
				defaultValue: false,
				description: messages.SCANNER_FIELD_STRICT_HELP,
			};
		case "secretScan":
			return {
				key,
				label: messages.SCANNER_FIELD_SECRET_SCAN,
				kind: "switch",
				group: "settings",
				defaultValue: false,
				description: messages.SCANNER_FIELD_SECRET_SCAN_HELP,
			};
		case "vulnScan":
			return {
				key,
				label: messages.SCANNER_FIELD_VULN_SCAN,
				kind: "switch",
				group: "settings",
				defaultValue: false,
				description: messages.SCANNER_FIELD_VULN_SCAN_HELP,
			};
		case "licenseScan":
			return {
				key,
				label: messages.SCANNER_FIELD_LICENSE_SCAN,
				kind: "switch",
				group: "settings",
				defaultValue: false,
				description: messages.SCANNER_FIELD_LICENSE_SCAN_HELP,
			};
		case "rulesSource":
			return {
				key,
				label: messages.SCANNER_FIELD_RULES_SOURCE,
				kind: "select",
				group: "settings",
				defaultValue: "environment",
				description: messages.SCANNER_FIELD_RULES_SOURCE_HELP,
				options: rulesSourceOptions(messages),
			};
		case "rulesRepo":
			return {
				key,
				label: messages.SCANNER_FIELD_RULES_REPO,
				kind: "url",
				group: "settings",
				placeholder: "https://github.com/trustabl/trustabl-rules",
				description: messages.SCANNER_FIELD_RULES_REPO_HELP,
			};
		case "rulesRef":
			return {
				key,
				label: messages.SCANNER_FIELD_RULES_REF,
				kind: "text",
				group: "settings",
				placeholder: "main",
				description: messages.SCANNER_FIELD_RULES_REF_HELP,
			};
		case "requireSigned":
			return {
				key,
				label: messages.SCANNER_FIELD_REQUIRE_SIGNED,
				kind: "switch",
				group: "settings",
				defaultValue: true,
				description: messages.SCANNER_FIELD_REQUIRE_SIGNED_HELP,
			};
		case "noRulesUpdate":
			return {
				key,
				label: messages.SCANNER_FIELD_NO_RULES_UPDATE,
				kind: "switch",
				group: "settings",
				defaultValue: false,
				description: messages.SCANNER_FIELD_NO_RULES_UPDATE_HELP,
			};
		case "verbose":
			return {
				key,
				label: messages.SCANNER_FIELD_VERBOSE,
				kind: "switch",
				group: "settings",
				defaultValue: false,
				description: messages.SCANNER_FIELD_VERBOSE_HELP,
			};
		default:
			return null;
	}
}

const FALLBACK_FLAG_KEYS = [
	"detectors",
	"strict",
	"secretScan",
	"vulnScan",
	"licenseScan",
	"rulesSource",
	"rulesRepo",
	"rulesRef",
	"requireSigned",
	"noRulesUpdate",
] as const;

function fieldFromCliFlag(
	flag: ScannerCliSchema["flags"][number],
	messages: ReturnType<typeof getMessage>
): FieldDef {
	const known = knownFlagField(flag.key, messages);
	if (known) return known;
	const kind: FieldDef["kind"] =
		flag.kind === "boolean" ? "switch" : flag.flag.endsWith("-repo") ? "url" : "text";
	return {
		key: flag.key,
		label: humanizeFromMessages(flag.flag, messages),
		kind,
		group: "settings",
		defaultValue: flag.kind === "boolean" ? Boolean(flag.defaultValue) : undefined,
		description: flag.help || messages.SCANNER_CLI_FLAG_HELP,
	};
}

function humanizeFromMessages(flag: string, messages: ReturnType<typeof getMessage>): string {
	return messages.SCANNER_CLI_FLAG_LABEL(flag);
}

function flagFields(
	messages: ReturnType<typeof getMessage>,
	schema?: ScannerCliSchema
): FieldDef[] {
	if (schema?.flags.length) {
		return schema.flags.map((flag) => fieldFromCliFlag(flag, messages));
	}
	return FALLBACK_FLAG_KEYS.map((key) => knownFlagField(key, messages)).filter(
		(field): field is FieldDef => !!field
	);
}

export function trustablConfigFields(schema?: ScannerCliSchema): FieldDef[] {
	const messages = getMessage();
	return [...ownedFields(messages), ...flagFields(messages, schema), ...credentialFields(messages)];
}

export function trustablRunParamFields(schema?: ScannerCliSchema): FieldDef[] {
	return trustablConfigFields(schema).filter((field) => field.group !== "credentials");
}
