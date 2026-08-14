// Provider names arrive from two vocabularies that must be unified before they
// are deduped/displayed:
//   - the controller's eBPF discovery uses short names: "gemini", "bedrock", ...
//   - OBI/SDK traces use the OTel GenAI semconv names: "gcp.gemini",
//     "aws.bedrock", "azure.ai.openai", ...
// Without normalization the same provider shows up twice on an agent (e.g.
// "gemini" + "gcp.gemini"), with only one of them matching a logo. We canonicalize
// to the SHORT name, which is what the UI's provider icon/label maps key on.
//
// Keep this in sync as new providers gain semconv names. It is intentionally a
// superset (aliases that don't occur yet are harmless).
const PROVIDER_ALIASES: Record<string, string> = {
	"gcp.gemini": "gemini",
	"gcp.vertex_ai": "vertex_ai",
	"gcp.vertex.ai": "vertex_ai",
	"aws.bedrock": "bedrock",
	"azure.ai.openai": "azure_openai",
	"azure.ai.inference": "azure_inference",
	"az.ai.openai": "azure_openai",
	"az.ai.inference": "azure_inference",
};

/** canonicalProvider maps a provider name (controller-short or OTel-semconv) to
 *  the single canonical short form used for dedup and logo/label lookup. */
export function canonicalProvider(name: string): string {
	const key = name.trim().toLowerCase();
	return PROVIDER_ALIASES[key] ?? key;
}

/** mergeProviders unions provider lists, canonicalizing names so aliases of the
 *  same provider collapse to one entry. Order is preserved (first occurrence). */
export function mergeProviders(...lists: Array<string[] | undefined>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const list of lists) {
		if (!list) continue;
		for (const raw of list) {
			if (!raw) continue;
			const c = canonicalProvider(raw);
			if (!seen.has(c)) {
				seen.add(c);
				out.push(c);
			}
		}
	}
	return out;
}
