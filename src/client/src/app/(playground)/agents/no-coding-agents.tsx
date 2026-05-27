"use client";

/**
 * Empty-state for the "Coding Agents" tab on /agents. Shown when the
 * org has no coding-agent telemetry yet. Mirrors the structure of
 * `NoController` (the Applications-tab empty state) so the visual
 * weight matches across tabs, but the body is a vendor-picker for
 * the four supported coding agents (Claude Code, Cursor, Codex,
 * Copilot CLI).
 *
 * Each vendor card is a tab that swaps the install snippet — we
 * intentionally keep the snippet copy-paste-ready and short, with a
 * link to the longer onboarding doc for the full reference (env
 * vars, content-capture modes, marketplace install, etc.).
 *
 * The CLI binary is installed once per machine via `install.sh` /
 * homebrew / docker (same as the controller path), so the top of the
 * picker re-uses the same code block formatting as `NoController`.
 * After the CLI is on PATH, `openlit coding install --vendor=<v>` is
 * idempotent and the only per-vendor step.
 */

import { useEffect, useMemo, useState } from "react";
import { BotMessageSquare, Copy, Check } from "lucide-react";
import copy from "copy-to-clipboard";
import {
	CodingAgentVendorIcon,
	hasCodingAgentVendorIcon,
} from "@/components/svg/coding-agents";

type VendorId = "claude-code" | "cursor" | "codex" | "copilot";

interface VendorMeta {
	id: VendorId;
	label: string;
	description: string;
	install: string;
	notes?: string;
}

const VENDORS: VendorMeta[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		description:
			"Anthropic's CLI / IDE plugin. Captures every assistant turn, every tool call, and authoritative token + cost from the session transcript.",
		install: "openlit coding install --vendor=claude-code",
		notes:
			"Wires SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStop, SessionEnd into ~/.claude/plugins/openlit-cc/.",
	},
	{
		id: "cursor",
		label: "Cursor",
		description:
			"Cursor IDE's hook system. Captures every prompt, response, thought, tool call, MCP call, and edit decision.",
		install: "openlit coding install --vendor=cursor",
		notes:
			"Wires the full Cursor hook surface (sessionStart/End, prompt/response/thought, tool + shell + MCP, subagents, file edits) into ~/.cursor/plugins/openlit/.",
	},
	{
		id: "codex",
		label: "Codex",
		description:
			"OpenAI Codex CLI. Captures per-turn LLM spans with input/output messages and tool calls, plus per-turn token deltas from the rollout JSONL.",
		install: "openlit coding install --vendor=codex",
		notes:
			"Materializes a local marketplace at ~/.local/share/openlit/codex-marketplace/ and registers it with Codex via `codex plugin marketplace add` + `codex plugin add openlit@openlit`. After install: restart Codex, run `/hooks` inside the TUI, and trust each `openlit@openlit` entry once (Codex requires manual trust on first run).",
	},
	{
		id: "copilot",
		label: "Copilot CLI",
		description:
			"GitHub Copilot CLI. Captures all ten Copilot hooks and tails ~/.copilot/session-state/events.jsonl for usage events.",
		install: "openlit coding install --vendor=copilot",
		notes:
			"Wires the full Copilot CLI hook surface into ~/.copilot/plugins/openlit/.",
	},
];

interface NoCodingAgentsProps {
	/**
	 * If true, render in a compact mode (no large hero, less padding).
	 * Used when this empty state is shown inside the Coding Agents tab
	 * body — the tabs above already supply the page-level context.
	 */
	compact?: boolean;
}

export default function NoCodingAgents({ compact = false }: NoCodingAgentsProps) {
	const [activeVendor, setActiveVendor] = useState<VendorId>("claude-code");
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const id = window.setTimeout(() => setCopied(false), 1800);
		return () => window.clearTimeout(id);
	}, [copied]);

	const vendor = useMemo(
		() => VENDORS.find((v) => v.id === activeVendor) || VENDORS[0],
		[activeVendor]
	);

	const cliBootstrap = "curl -fsSL https://openlit.io/install.sh | sh";
	const configure =
		'openlit configure --endpoint "$OPENLIT_OTLP_ENDPOINT" --api-key "$OPENLIT_API_KEY"';
	const snippet = [
		"# 1. Install the openlit CLI (one-time, all coding agents):",
		cliBootstrap,
		"",
		"# 2. Point it at this OpenLit instance:",
		configure,
		"",
		`# 3. Wire ${vendor.label} hooks:`,
		vendor.install,
	].join("\n");

	const handleCopy = () => {
		copy(snippet);
		setCopied(true);
	};

	return (
		<div
			className={`flex flex-col items-center w-full ${compact ? "py-6 px-1" : "justify-center py-12 px-4"}`}
		>
			<div className="max-w-2xl w-full">
				{!compact && (
					<div className="flex flex-col items-center mb-8">
						<div className="w-16 h-16 bg-stone-100 dark:bg-stone-800 rounded-full flex items-center justify-center mb-4">
							<BotMessageSquare className="w-8 h-8 text-stone-500 dark:text-stone-400" />
						</div>
						<h2 className="text-2xl font-semibold text-stone-700 dark:text-stone-200 mb-2">
							Track your coding agents
						</h2>
						<p className="text-stone-500 dark:text-stone-400 text-center max-w-md">
							Pick a tool to see the install snippet. The OpenLit
							CLI hooks into the agent and ships every session,
							tool call, and LLM turn to this stack &mdash; no
							SDK or code changes required.
						</p>
					</div>
				)}

				<div className="border dark:border-stone-800 rounded-lg overflow-hidden">
					<div className="flex flex-wrap border-b border-stone-200 dark:border-stone-700">
						{VENDORS.map((v) => {
							const isActive = activeVendor === v.id;
							const hasIcon = hasCodingAgentVendorIcon(v.id);
							return (
								<button
									key={v.id}
									onClick={() => setActiveVendor(v.id)}
									className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
										isActive
											? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 border-b-2 border-stone-900 dark:border-stone-100"
											: "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
									}`}
								>
									{hasIcon && (
										<CodingAgentVendorIcon
											vendor={v.id}
											className="w-4 h-4"
										/>
									)}
									{v.label}
								</button>
							);
						})}
					</div>
					<div className="p-4 space-y-3 bg-stone-50 dark:bg-stone-900">
						<p className="text-sm text-stone-600 dark:text-stone-400">
							{vendor.description}
						</p>
						<div className="relative rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
							<button
								onClick={handleCopy}
								className="absolute top-2.5 right-2.5 p-1.5 rounded-md text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
								title="Copy commands"
							>
								{copied ? (
									<Check className="w-4 h-4 text-emerald-500" />
								) : (
									<Copy className="w-4 h-4" />
								)}
							</button>
							<pre className="text-xs font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap pr-8 leading-relaxed">
								{snippet}
							</pre>
						</div>
						{vendor.notes && (
							<p className="text-xs text-stone-500 dark:text-stone-500">
								{vendor.notes}
							</p>
						)}
						<p className="text-xs text-stone-500 dark:text-stone-500">
							Full reference (env vars, content-capture modes,
							marketplace install):{" "}
							<a
								href="https://docs.openlit.io/latest/features/coding-agents/onboarding"
								target="_blank"
								rel="noreferrer"
								className="text-primary hover:underline"
							>
								coding-agents onboarding
							</a>
							.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
