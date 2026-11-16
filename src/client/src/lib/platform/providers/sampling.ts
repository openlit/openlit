import type { LanguageModel } from "ai";

export type SamplingSettings = {
	temperature?: number;
	topP?: number;
	topK?: number;
};

// Version separators may be "-" or "." (claude-opus-4-7, anthropic/claude-opus-4.7).
// A minor is at most two digits so date suffixes (…-4-20250514) are not read
// as a minor version.
const BOUNDARY = "(?=$|[-@:._/])";
const CLAUDE_FAMILY_FIRST = new RegExp(
	`claude-(?:opus|sonnet|haiku)-(\\d+)(?:[-.](\\d{1,2}))?${BOUNDARY}`
);
const CLAUDE_VERSION_FIRST = new RegExp(
	`claude-(\\d+)(?:[-.](\\d{1,2}))?-(?:opus|sonnet|haiku)${BOUNDARY}`
);
const CLAUDE_LEGACY = new RegExp(`claude-(?:v?[12]|instant)${BOUNDARY}`);

function modelIdOf(model: LanguageModel | string): string {
	if (typeof model === "string") return model;
	return (model as { modelId?: string }).modelId || "";
}

/** Claude 4.6 is the last generation that accepts sampling parameters. */
function acceptsSampling(major: number, minor: number): boolean {
	return major < 4 || (major === 4 && minor <= 6);
}

/**
 * Whether a model accepts `temperature` / `top_p` / `top_k`.
 *
 * Claude models from Opus 4.7 / Sonnet 5 / Haiku 5.5 / Fable onward reject
 * explicit sampling parameters with a 400 (removed outright, or any
 * non-default value). Only the older Claude generations (Claude 1/2/3, and
 * the 4.x line up to 4.6) still accept them. Unknown Claude model ids are
 * treated as new, because sampling is optional for every caller and sending
 * it to a model that rejects it fails the whole request. Matching uses the
 * model id so proxied ids (`anthropic.claude-…`, `anthropic/claude-…`,
 * OpenAI-compatible gateways) are covered too. Non-Claude models are left
 * unchanged.
 */
export function supportsSamplingParams(model: LanguageModel | string): boolean {
	const id = modelIdOf(model).toLowerCase();
	if (!id.includes("claude")) return true;

	const versioned = id.match(CLAUDE_VERSION_FIRST) || id.match(CLAUDE_FAMILY_FIRST);
	if (versioned) {
		const major = Number(versioned[1]);
		const minor = versioned[2] === undefined ? 0 : Number(versioned[2]);
		return acceptsSampling(major, minor);
	}
	return CLAUDE_LEGACY.test(id);
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
