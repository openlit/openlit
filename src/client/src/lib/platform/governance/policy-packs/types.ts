import type {
	GovernanceFindingCategory,
	GovernancePolicyFramework,
	GovernanceSeverity,
} from "@/types/governance-report";

/**
 * One control mapping inside a policy pack.
 *
 * Add new rows to the pack file for your framework (e.g. `nist-ai-rmf.ts`).
 * The aggregator in `index.ts` loads every registered pack — no other
 * wiring is required beyond appending the pack to `POLICY_PACKS`.
 */
export type PolicyPackControl = {
	control_id: string;
	title: string;
	/** Finding categories that implicate this control when present. */
	finding_categories: GovernanceFindingCategory[];
	/**
	 * Optional floor: only match when at least one implicated finding
	 * is at this severity or higher (`info` < `minor` < `major` < `critical`).
	 */
	min_severity?: GovernanceSeverity;
	/** Short auditor-facing note (optional; surfaced on the control when set). */
	rationale?: string;
};

export type PolicyPack = {
	/** Stable pack id (filesystem / docs), e.g. `nist-ai-rmf`. */
	id: string;
	framework: GovernancePolicyFramework;
	version: string;
	controls: PolicyPackControl[];
};

/** Flattened entry used by the matcher (pack metadata + one control). */
export type PolicyPackEntry = PolicyPackControl & {
	framework: GovernancePolicyFramework;
	pack_id: string;
};

export const SEVERITY_RANK: Record<GovernanceSeverity, number> = {
	info: 0,
	minor: 1,
	major: 2,
	critical: 3,
};

export function definePolicyPack(pack: PolicyPack): PolicyPack {
	return pack;
}

export function flattenPolicyPack(pack: PolicyPack): PolicyPackEntry[] {
	return pack.controls.map((control) => ({
		...control,
		framework: pack.framework,
		pack_id: pack.id,
	}));
}
