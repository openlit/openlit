/**
 * Scanner connector contract.
 *
 * Scanner adapters are the category-specific runtime behind `category: "scanner"`
 * connector instances. Vendors implement only the operations their
 * `capabilities()` advertise; the rest throw `UnsupportedScannerCapabilityError`
 * so product surfaces can gate honestly instead of guessing.
 */

import type { ConnectorHealthResult, ConnectorRuntime } from "../types";
import type { AuthStyle, FieldDef } from "../datasource/types";
import type { ScannerCliSchema, ScannerForgeSchema } from "./cli-schema";

export interface ScannerCapabilities {
	install: boolean;
	scan: boolean;
	listFindings: boolean;
	/** Generates a pre-coding skill (Trustabl Forge). */
	forge?: boolean;
}

export type ScannerJobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "runtime-missing";

export interface ScannerFinding {
	id: string;
	ruleId: string;
	severity: string;
	category?: string;
	scope?: string;
	toolName?: string;
	path?: string;
	line?: number;
	endLine?: number;
	title: string;
	message?: string;
	helpUrl?: string;
	fix?: string;
	confidence?: string;
	extras?: Record<string, string>;
}

/** Resolved Trustabl `scan` flags persisted on the job (no secrets). */
export interface ScannerScanParams {
	detectors?: string;
	strict?: boolean;
	secretScan?: boolean;
	vulnScan?: boolean;
	licenseScan?: boolean;
	requireSigned?: boolean;
	rulesRepo?: string;
	rulesRef?: string;
	rulesSource?: string;
	noRulesUpdate?: boolean;
	verbose?: boolean;
	extras?: Record<string, string | boolean>;
}

/** Per-run overrides. Missing fields fall back to connector defaults. */
export interface ScannerScanInput extends ScannerScanParams {
	target?: string;
	ref?: string;
}

export interface ScannerReportSummary {
	scanId?: string;
	repo?: string;
	overallScore?: number;
	rulesSource?: string;
	rulesVersion?: string;
	rulesFromCache?: boolean;
	rulesStale?: boolean;
	rulesOrigin?: string;
	languages?: string[];
	sdks?: string[];
	toolCount?: number;
	agentCount?: number;
	mcpCount?: number;
	skillCount?: number;
	subagentCount?: number;
	vulnerabilityCount?: number;
	secretCount?: number;
	filesParsed?: number;
	filesSkipped?: number;
	noAgentSurfaces?: boolean;
	extras?: Record<string, string>;
}

export interface ScannerJob {
	id: string;
	status: ScannerJobStatus;
	target: string;
	ref?: string;
	startedAt: string;
	finishedAt?: string;
	durationMs?: number;
	exitCode?: number;
	error?: string;
	findingCount?: number;
	mediumPlusCount?: number;
	findings?: ScannerFinding[];
	params?: ScannerScanParams;
	report?: ScannerReportSummary;
	/** Trustabl CLI version used for this job, e.g. `v0.1.8`. */
	cliVersion?: string;
}

export type ScannerRepoFindingsMatch = {
	matched: true;
	repoKey: string;
	connectorId: string;
	connectorName: string;
	jobId: string;
	target: string;
	ref?: string;
	scannedAt: string;
	findingCount: number;
	mediumPlusCount: number;
	findings: ScannerFinding[];
	url: string;
};

export type ScannerRepoFindingsMiss = {
	matched: false;
	repoKey: string | null;
	url: string;
};

export type ScannerRepoFindingsResult =
	| ScannerRepoFindingsMatch
	| ScannerRepoFindingsMiss;

export interface ScannerRuntimeInfo {
	installed: boolean;
	version?: string;
	source?: "env" | "path" | "cache";
	binaryVersion?: string;
	latestVersion?: string;
	upgradeAvailable?: boolean;
	schema?: ScannerCliSchema;
	/** Forge flags and accepted policies; absent when the CLI has no forge command. */
	forge?: ScannerForgeSchema;
}

export type ScannerForgeStatus = "running" | "succeeded" | "failed" | "runtime-missing";

/** Where a forge run's policies came from. */
export interface ScannerForgePolicySource {
	kind: "analyzer" | "manual";
	jobId?: string;
	scannedAt?: string;
}

/** Resolved `trustabl forge` flags persisted on the run (no secrets). */
export interface ScannerForgeParams {
	policies: string[];
	rulesRef?: string;
	/** Display and download name; forge itself writes to stdout. */
	fileName: string;
	extras?: Record<string, string | boolean>;
}

/** Per-run input. Missing fields fall back to connector settings or the latest Analyzer scan. */
export interface ScannerForgeRunInput extends Partial<ScannerForgeParams> {
	target?: string;
	sourceJobId?: string;
}

export interface ScannerForgeSkillSection {
	title: string;
	ruleCount: number;
	groups: { title: string; ruleCount: number }[];
}

/** Stats read from a generated SKILL.md. */
export interface ScannerForgeSkillSummary {
	name?: string;
	description?: string;
	stamp?: {
		generated?: string;
		rulesSha?: string;
		schema?: string;
		sdks?: string[];
	};
	ruleCount: number;
	severityCounts: { critical: number; high: number; medium: number; low: number };
	sections: ScannerForgeSkillSection[];
	lineCount: number;
	byteLength: number;
}

export interface ScannerForgeRun {
	id: string;
	status: ScannerForgeStatus;
	target: string;
	policies: string[];
	policySource: ScannerForgePolicySource;
	rulesRef?: string;
	fileName: string;
	extras?: Record<string, string | boolean>;
	startedAt: string;
	finishedAt?: string;
	durationMs?: number;
	exitCode?: number;
	error?: string;
	cliVersion?: string;
	/** Command OpenLIT ran, for display. */
	command?: string;
	summary?: ScannerForgeSkillSummary;
	/** SKILL.md body. Only returned by the single-run endpoint. */
	content?: string;
}

/** Result of `trustabl forge check` for a stored run. */
export interface ScannerForgeCheck {
	status: "current" | "stale" | "error";
	message: string;
	checkedAt: string;
}

export interface ScannerSourceDescriptor {
	type: string;
	id: string;
	settings: Record<string, unknown>;
	secretRef?: string | null;
	projectId?: string | null;
	name: string;
	environment?: string;
}

export interface ScannerTypeDescriptor {
	type: string;
	displayName: string;
	description?: string;
	internal?: boolean;
	icon?: string;
	capabilities: ScannerCapabilities;
	configFields: FieldDef[];
	authStyle: AuthStyle;
	authHelp?: string;
	docsUrl?: string;
	pinnedVersion?: string;
}

export interface ScannerAdapter extends ConnectorRuntime {
	readonly type: string;
	capabilities(): ScannerCapabilities;
	healthCheck(): Promise<ConnectorHealthResult>;
	ensureRuntime(input?: { upgrade?: boolean }): Promise<ScannerRuntimeInfo>;
	scan(input?: ScannerScanInput): Promise<ScannerJob>;
	forge?(input: ScannerForgeAdapterInput): Promise<ScannerForgeRun>;
	checkForge?(content: string, rulesRef?: string): Promise<ScannerForgeCheck>;
}

/** Fully resolved forge input handed to an adapter. */
export interface ScannerForgeAdapterInput extends ScannerForgeParams {
	target: string;
	policySource: ScannerForgePolicySource;
}

export interface ScannerAdapterFactory {
	type: string;
	create(descriptor: ScannerSourceDescriptor): ScannerAdapter;
	describe(): ScannerTypeDescriptor;
}

export class UnsupportedScannerCapabilityError extends Error {
	readonly capability: string;
	readonly sourceType: string;
	constructor(sourceType: string, capability: string, message?: string) {
		super(
			message ||
				`Capability "${capability}" is not supported by scanner connector "${sourceType}".`
		);
		this.name = "UnsupportedScannerCapabilityError";
		this.capability = capability;
		this.sourceType = sourceType;
	}
}
