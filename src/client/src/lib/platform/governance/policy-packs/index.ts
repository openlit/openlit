import type {
	GovernanceFinding,
	GovernancePolicyControl,
	GovernanceSeverity,
} from "@/types/governance-report";
import { euAiActPack } from "./eu-ai-act";
import { nistAiRmfPack } from "./nist-ai-rmf";
import { owaspAsiPack } from "./owasp-asi";
import {
	flattenPolicyPack,
	SEVERITY_RANK,
	type PolicyPack,
	type PolicyPackEntry,
} from "./types";

export type { PolicyPack, PolicyPackControl, PolicyPackEntry } from "./types";
export { definePolicyPack, flattenPolicyPack, SEVERITY_RANK } from "./types";
export { nistAiRmfPack } from "./nist-ai-rmf";
export { euAiActPack } from "./eu-ai-act";
export { owaspAsiPack } from "./owasp-asi";

/**
 * Registry of active governance policy packs.
 *
 * ## Adding coverage
 *
 * 1. Create `policy-packs/<your-pack>.ts` that calls `definePolicyPack({...})`
 *    (or append controls to an existing framework file).
 * 2. Import the pack here and push it onto `POLICY_PACKS`.
 * 3. If you introduce a new framework id, extend `GovernancePolicyFramework`
 *    in `@/types/governance-report` and any UI that labels frameworks.
 *
 * Packs are evaluated in registry order; duplicate `framework`+`control_id`
 * pairs from later packs are skipped so overlays can refine without double
 * counting.
 */
export const POLICY_PACKS: PolicyPack[] = [
	nistAiRmfPack,
	euAiActPack,
	owaspAsiPack,
];

/** Flat control list used by the matcher (derived from `POLICY_PACKS`). */
export const GOVERNANCE_POLICY_PACK: PolicyPackEntry[] = POLICY_PACKS.flatMap(
	flattenPolicyPack
);

function maxSeverityForCategories(
	findings: GovernanceFinding[],
	categories: Set<string>
): GovernanceSeverity | null {
	let max: GovernanceSeverity | null = null;
	for (const finding of findings) {
		if (!categories.has(finding.category)) continue;
		if (
			max == null ||
			SEVERITY_RANK[finding.severity] > SEVERITY_RANK[max]
		) {
			max = finding.severity;
		}
	}
	return max;
}

/**
 * Map report findings to implicated policy controls across all registered
 * packs. Returns only controls that have at least one matching category
 * (and that satisfy optional `min_severity`).
 */
export function policyControlsForFindings(
	findings: GovernanceFinding[]
): GovernancePolicyControl[] {
	const present = new Set(findings.map((f) => f.category));
	const matched: GovernancePolicyControl[] = [];
	const seen = new Set<string>();

	for (const entry of GOVERNANCE_POLICY_PACK) {
		const hitCategories = entry.finding_categories.filter((c) =>
			present.has(c)
		);
		if (!hitCategories.length) continue;

		if (entry.min_severity) {
			const peak = maxSeverityForCategories(
				findings,
				new Set(hitCategories)
			);
			if (
				peak == null ||
				SEVERITY_RANK[peak] < SEVERITY_RANK[entry.min_severity]
			) {
				continue;
			}
		}

		const dedupeKey = `${entry.framework}:${entry.control_id}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);

		matched.push({
			framework: entry.framework,
			control_id: entry.control_id,
			title: entry.title,
			finding_categories: hitCategories,
			...(entry.rationale ? { rationale: entry.rationale } : {}),
			pack_id: entry.pack_id,
		});
	}

	return matched;
}

/** List registered packs (for docs / diagnostics). */
export function listPolicyPacks(): Array<{
	id: string;
	framework: PolicyPack["framework"];
	version: string;
	control_count: number;
}> {
	return POLICY_PACKS.map((pack) => ({
		id: pack.id,
		framework: pack.framework,
		version: pack.version,
		control_count: pack.controls.length,
	}));
}
