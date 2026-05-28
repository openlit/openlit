/**
 * Vendor icons for coding-agent rows. Mirrors the convention in
 * `components/svg/providers.tsx` — tiny SVGs inlined as React components
 * so we don't add network round-trips to the agents hub or the session
 * list. Each icon takes a `className` for sizing/colour.
 *
 * Source attributions:
 *   - Cursor: derived from icons8.com (cursor-ai), simplified for inline
 *     rendering. Recolours via the parent `text-*` class are not
 *     supported because Cursor's logo uses a deliberate multi-tone fill.
 *   - Claude Code: official Anthropic Claude Code mark, inlined as a
 *     single-path SVG. Single-tone (#D97757) so it tints correctly when
 *     placed inside a coloured pill.
 *   - Codex: derived from OpenAI's official Codex flower / swirl mark.
 *     Hand-traced as four 90°-rotated petals + an inner counter-flower
 *     so the icon stays under ~1KB and tints via `currentColor` when no
 *     explicit fill is supplied. The default fill (#788CFE) matches the
 *     primary swirl colour in the upstream SVG so the icon still reads
 *     as "Codex" outside a coloured pill.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

export function CursorIcon({ className = "h-4 w-4", ...rest }: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 48 48"
			fillRule="evenodd"
			clipRule="evenodd"
			baseProfile="basic"
			className={className}
			aria-label="Cursor"
			role="img"
			{...rest}
		>
			<polygon
				fill="#bcbcbc"
				points="23.974,4 6.97,14 6.97,34 23.998,44 40.97,34 40.97,14"
			/>
			<polygon fill="#757575" points="23.974,4 6.97,14 6.97,34 23.97,24" />
			<polygon fill="#424242" points="23.981,14 40.97,14 40.97,34 23.971,24" />
			<polygon
				fill="#616161"
				fillRule="evenodd"
				points="40.97,14 23.966,17 23.974,4"
				clipRule="evenodd"
			/>
			<polygon
				fill="#616161"
				fillRule="evenodd"
				points="6.97,14 23.981,16.881 23.966,24 6.97,34"
				clipRule="evenodd"
			/>
			<polygon
				fill="#ededed"
				points="6.97,14 23.97,24 23.998,44 40.97,14"
			/>
		</svg>
	);
}

export function ClaudeCodeIcon({
	className = "h-4 w-4",
	...rest
}: IconProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			className={className}
			aria-label="Claude Code"
			role="img"
			{...rest}
		>
			<path
				clipRule="evenodd"
				d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
				fill="#D97757"
				fillRule="evenodd"
			/>
		</svg>
	);
}

export function CodexIcon({ className = "h-4 w-4" }: IconProps) {
	// The official Codex flower mark is detail-heavy (~120 traced paths
	// covering the photo-realistic gradient swirl), so embedding it
	// inline would bloat the JS bundle. We serve the asset from
	// /public/images/codex.svg instead and reference it via <img> so
	// Next.js streams it as a static file and the browser caches it.
	// The <img> still accepts the same className the other vendor icons
	// take, so this remains a drop-in for the existing call-sites.
	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img src="/images/codex.svg" alt="Codex" className={className} />
	);
}

/**
 * Returns true when we have an inline logo for the given vendor.
 * Callers (table rows, session cards, trace-detail pills) use this
 * to decide whether to render `CodingAgentVendorIcon` or the generic
 * `Bot` fallback. Centralising the check here means new vendors only
 * have to land their SVG + the switch case below; the conditionals in
 * the consumer files don't need to be updated each time.
 */
export function hasCodingAgentVendorIcon(
	vendor: string | null | undefined,
): boolean {
	if (!vendor) return false;
	switch (vendor.toLowerCase()) {
		case "cursor":
		case "claude-code":
		case "codex":
			return true;
		default:
			return false;
	}
}

/**
 * Pretty display label for a coding-agent vendor id. The vendor ids
 * we ship internally are kebab-case (`claude-code`) or lowercase
 * (`cursor`, `codex`); call-sites that show a human-facing string
 * should funnel through this helper so the spelling stays consistent
 * across the hub table, the agent detail header, trace pills, and the
 * onboarding tabs. New vendors only need a row here once their icon
 * lands.
 */
const CODING_AGENT_VENDOR_LABELS: Record<string, string> = {
	cursor: "Cursor",
	"claude-code": "Claude Code",
	codex: "Codex",
	windsurf: "Windsurf",
};

export function codingAgentVendorLabel(
	vendor: string | null | undefined,
): string {
	if (!vendor) return "Unknown";
	return CODING_AGENT_VENDOR_LABELS[vendor.toLowerCase()] || vendor;
}

/**
 * Single dispatch point for "render the right logo for this coding-agent
 * vendor". Falls back to null when we don't have an icon yet (so the
 * caller can keep the text-only label). Add new vendors here when new
 * logos land. Keep `hasCodingAgentVendorIcon` in sync with the switch.
 */
export function CodingAgentVendorIcon({
	vendor,
	className,
}: {
	vendor: string | null | undefined;
	className?: string;
}) {
	if (!vendor) return null;
	switch (vendor.toLowerCase()) {
		case "cursor":
			return <CursorIcon className={className} />;
		case "claude-code":
			return <ClaudeCodeIcon className={className} />;
		case "codex":
			return <CodexIcon className={className} />;
		default:
			return null;
	}
}
