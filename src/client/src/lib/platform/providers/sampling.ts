import type { LanguageModel } from "ai";

export type SamplingSettings = {
	temperature?: number;
	topP?: number;
	topK?: number;
};

const CLAUDE_FAMILY_FIRST = /claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?=$|[-@:.])/;
const CLAUDE_VERSION_FIRST = /claude-(\d+)(?:[-.](\d{1,2}))?-(opus|sonnet|haiku)/;
const CLAUDE_LEGACY = /claude-(?:2|instant)(?=$|[-@:.])/;

function modelIdOf(model: LanguageModel | string): string {
	if (typeof model === "string") return model;
	return (model as { modelId?: string }).modelId || "";
}

/**
 * Whether a model accepts `temperature` / `top_p` / `top_k`.
 *
 * Claude models from Opus 4.7 / Sonnet 5 / Haiku 5.5 / Fable onward reject
 * explicit sampling parameters with a 400 (removed outright, or any
 * non-default value). Only the older Claude generations (Claude 2/3, and the
 * 4.x line up to 4.6) still accept them. Unknown Claude model ids are treated
 * as new, because sampling is optional for every caller and sending it to a
 * model that rejects it fails the whole request. Matching uses the model id
 * so proxied ids (`anthropic.claude-…`, OpenAI-compatible gateways) are
 * covered too. Non-Claude models are left unchanged.
 */
export function supportsSamplingParams(model: LanguageModel | string): boolean {
	const id = modelIdOf(model).toLowerCase();
	if (!id.includes("claude")) return true;
	if (CLAUDE_LEGACY.test(id)) return true;
	if (CLAUDE_VERSION_FIRST.test(id)) return true; // claude-3-5-sonnet, claude-3-opus…
	const match = id.match(CLAUDE_FAMILY_FIRST);
	if (!match) return false;
	const major = Number(match[2]);
	const minor = match[3] === undefined ? 0 : Number(match[3]);
	return major < 4 || (major === 4 && minor <= 6);
}

/** Returns only the sampling settings the model accepts. */
export function samplingFor(
	model: LanguageModel | string,
	settings: SamplingSettings
): SamplingSettings {
	if (supportsSamplingParams(model)) {
		return Object.fromEntries(
			Object.entries(settings).filter(([, value]) => value !== undefined)
		) as SamplingSettings;
	}
	return {};
}
