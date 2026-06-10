"use client";

/**
 * Empty-state for the "Coding Agents" tab on /agents. Shown when the
 * org has no coding-agent telemetry yet.
 *
 * The snippet is auto-filled with two values pulled from the running
 * dashboard:
 *
 *  - OPENLIT_OTLP_ENDPOINT: derived from `window.location.origin` with
 *    the port replaced by 4318 (the collector's HTTP listener). Uses
 *    the URL Web API rather than string concatenation per the
 *    frontend-security rule.
 *  - OPENLIT_API_KEY: pulled from the first existing API key in this
 *    org; if none exists, an inline "Generate API key" button POSTs to
 *    /api/api-key (same backend the Settings page uses) and the
 *    returned key replaces the placeholder in the snippet.
 *
 * Per-vendor descriptions / hook lists are removed — the deep
 * reference lives at docs.openlit.io/.../coding-agents/onboarding.
 */

import { ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import {
	BotMessageSquare,
	Check,
	Copy,
	KeyRound,
	Loader2,
} from "lucide-react";
import copy from "copy-to-clipboard";
import { toast } from "sonner";
import {
	CodingAgentVendorIcon,
	hasCodingAgentVendorIcon,
} from "@/components/svg/coding-agents";
import LinuxSvg from "@/components/svg/linux";
import MacSvg from "@/components/svg/mac";
import WindowsSvg from "@/components/svg/windows";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { ApiKey } from "@/types/api-key";

type OsIconComponent = ComponentType<{ className?: string }>;

type VendorId = "claude-code" | "cursor" | "codex";
type OsId = "macos" | "linux" | "windows";

interface VendorMeta {
	id: VendorId;
	label: string;
	// Argument passed to `openlit coding install --vendor=<v>`. The
	// full command is composed at render time using the OS-specific
	// openlit invocation (see bootstrapForOs.openlitBin) — hardcoding
	// `openlit coding install …` here would break the Windows
	// PowerShell path which has to use the `&` call operator.
	cliFlag: string;
	// User-facing post-install steps shown under the snippet. The
	// install command writes hook files (and registers plugins where
	// the vendor's CLI is available), but the *agent process itself*
	// generally caches its hook table at process start, so the user
	// has to bounce the agent before telemetry starts flowing. Codex
	// additionally requires an in-TUI trust step.
	postInstall: {
		// One-line, imperative restart instruction. Renders as the
		// first step regardless of vendor.
		restart: string;
		// Optional follow-up steps. Currently only Codex needs them.
		extraSteps?: string[];
	};
}

interface OsMeta {
	id: OsId;
	label: string;
	icon: OsIconComponent;
}

const VENDORS: VendorMeta[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		cliFlag: "claude-code",
		postInstall: {
			restart: "Quit and reopen Claude Code.",
		},
	},
	{
		id: "cursor",
		label: "Cursor",
		cliFlag: "cursor",
		postInstall: {
			restart: "Fully quit Cursor (⌘Q on macOS, File → Exit on Windows/Linux) and reopen it.",
		},
	},
	{
		id: "codex",
		label: "Codex",
		cliFlag: "codex",
		postInstall: {
			restart: "Restart Codex (or open a new `codex` session in a fresh shell).",
			// Codex's security model requires every plugin hook to
			// be explicitly trusted in the TUI before it fires —
			// without this step, the plugin is "installed" but
			// inert and no telemetry reaches OpenLit. The "send a
			// prompt" follow-up that used to live here was dropped
			// because the generic "Start a session in <vendor>"
			// step rendered below covers it.
			extraSteps: [
				"Inside Codex, run `/hooks` and trust each `openlit@openlit` entry.",
			],
		},
	},
];

// Use the locally vendored brand SVGs (icons8) so the OS cards
// match the existing controllers page (which already uses
// LinuxSvg for the same purpose). All three use `currentColor`
// so the active-state highlight in dark mode picks them up.
const OS_OPTIONS: OsMeta[] = [
	{ id: "macos", label: "macOS", icon: MacSvg },
	{ id: "linux", label: "Linux", icon: LinuxSvg },
	{ id: "windows", label: "Windows", icon: WindowsSvg },
];

const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318";
const API_KEY_PLACEHOLDER = "$OPENLIT_API_KEY";
const GENERATED_API_KEY_NAME = "coding-agents";

// OS-specific install bootstrap.
//
// Each branch resolves to:
//
//   install    The one-liner that lands the `openlit` binary on disk.
//   openlitBin How subsequent commands in the same chain should
//              invoke openlit. CRITICAL: we cannot rely on bare
//              `openlit` here, because the install step's PATH
//              update (rc-file edit on Unix, registry edit on
//              Windows) only takes effect in NEW shells, not the
//              one currently parsing the `&&` chain. Using an
//              explicit path makes the chain work on first paste
//              without requiring a terminal restart.
//   joiner     Shell command separator: bash `&&` short-circuits on
//              failure; PowerShell 5.1 doesn't support `&&` (only
//              PS7+ does), so Windows uses `;`.
//
// Per-OS choices:
//   macOS   → Homebrew tap (`openlit/openlit/openlit`). Bare
//             `openlit` works in the chain because brew's
//             `/opt/homebrew/bin` (or `/usr/local/bin` on Intel
//             Macs) is already on PATH at shell startup.
//   Linux   → cli/scripts/install.sh in this repo, hosted via raw
//             GitHub. Drops the binary at `~/.openlit/bin/openlit`;
//             the chain uses that absolute path because the install
//             dir isn't on PATH yet for the current shell. zsh /
//             bash / dash all tilde-expand on parse so `~/...`
//             works without `eval`.
//   Windows → cli/scripts/install.ps1, same channel. Drops the
//             binary at `$env:USERPROFILE\.openlit\bin\openlit.exe`.
//             The chain uses PowerShell's `&` call operator with
//             an explicit path so backslashes parse correctly.
//
// Pinning the install-script URLs to `main` (rather than a release
// tag) means the snippet auto-tracks whatever is on the default
// branch. Switch to a tag like `cli-1.2.0` once releases settle.
const INSTALL_SCRIPTS_BASE =
	"https://raw.githubusercontent.com/openlit/openlit/main/cli/scripts";

interface OsBootstrap {
	install: string;
	// Optional, OS-specific command that makes `openlit` available in the
	// *current* shell session after install (i.e. before the user opens a
	// new terminal). Without this, `install.sh` / `install.ps1` can only
	// update PATH for future shells (rc-file edit / user PATH), and a
	// chained one-liner would fail at `openlit configure`.
	activate?: string;
	joiner: string;
}

function bootstrapForOs(os: OsId): OsBootstrap {
	switch (os) {
		case "macos":
			return {
				install: "brew install openlit/openlit/openlit",
				// brew writes into a directory already on PATH for the
				// current shell, so no activation step needed.
				joiner: " && ",
			};
		case "windows":
			return {
				install: `iwr -useb ${INSTALL_SCRIPTS_BASE}/install.ps1 | iex`,
				// Update the current PowerShell session PATH (user PATH
				// updates only apply to new shells). This makes `openlit`
				// immediately runnable in a chained one-liner.
				activate: `$env:Path = "$env:USERPROFILE\\.openlit\\bin;$env:Path"`,
				joiner: "; ",
			};
		case "linux":
		default:
			return {
				install: `curl -fsSL ${INSTALL_SCRIPTS_BASE}/install.sh | sh`,
				// Ensure `openlit` is available in the current shell so the
				// chained snippet can run `openlit configure` without
				// requiring a terminal restart.
				activate: `export PATH="$HOME/.openlit/bin:$PATH"`,
				joiner: " && ",
			};
	}
}

/**
 * Replace the port on a URL with 4318 (OpenLit collector's HTTP/OTLP
 * port). When the input has no explicit port (e.g.
 * `https://openlit.example.com`), `URL.port = "..."` still appends it.
 *
 * Returns the input as-is if it doesn't parse as a URL so a freshly
 * loaded SSR pass — where the value is the default — still renders
 * sensibly.
 */
function buildOtlpEndpoint(origin: string): string {
	try {
		const url = new URL(origin);
		url.port = "4318";
		return url.origin;
	} catch {
		return DEFAULT_OTLP_ENDPOINT;
	}
}

interface NoCodingAgentsProps {
	/**
	 * If true, render in a compact mode (no large hero, less padding).
	 * Used when this empty state is shown inside the Coding Agents tab
	 * body — the tabs above already supply the page-level context.
	 */
	compact?: boolean;
}

function detectOs(): OsId {
	if (typeof navigator === "undefined") return "macos";
	const platform =
		(navigator as Navigator & { userAgentData?: { platform?: string } })
			.userAgentData?.platform ||
		navigator.platform ||
		navigator.userAgent ||
		"";
	const p = platform.toLowerCase();
	if (p.includes("win")) return "windows";
	if (p.includes("linux") || p.includes("x11")) return "linux";
	return "macos";
}

export default function NoCodingAgents({ compact = false }: NoCodingAgentsProps) {
	const [activeVendor, setActiveVendor] = useState<VendorId>("claude-code");
	// Initialize from the browser's reported platform so the snippet
	// matches the user's machine on first paint. They can flip it via
	// the OS cards if their dev box differs from the browser host.
	const [activeOs, setActiveOs] = useState<OsId>("macos");
	const [copied, setCopied] = useState(false);
	const [otlpEndpoint, setOtlpEndpoint] = useState(DEFAULT_OTLP_ENDPOINT);

	useEffect(() => {
		setActiveOs(detectOs());
	}, []);

	const pingStatus = useRootStore(getPingStatus);
	const { data: apiKeys, fireRequest: fetchKeys } = useFetchWrapper<ApiKey[]>();
	const { fireRequest: createKey, isLoading: isCreatingKey } =
		useFetchWrapper<{ apiKey: string }>();

	// Derive the OTLP endpoint from the dashboard origin on mount. We
	// only run this on the client because window.location isn't defined
	// during SSR.
	useEffect(() => {
		if (typeof window !== "undefined") {
			setOtlpEndpoint(buildOtlpEndpoint(window.location.origin));
		}
	}, []);

	const refreshKeys = useCallback(() => {
		fetchKeys({ requestType: "GET", url: "/api/api-key" });
	}, [fetchKeys]);

	useEffect(() => {
		if (pingStatus !== "pending") refreshKeys();
	}, [pingStatus, refreshKeys]);

	useEffect(() => {
		if (!copied) return;
		const id = window.setTimeout(() => setCopied(false), 1800);
		return () => window.clearTimeout(id);
	}, [copied]);

	const firstKey =
		apiKeys && apiKeys.length > 0 ? apiKeys[0].apiKey : undefined;

	const vendor = useMemo(
		() => VENDORS.find((v) => v.id === activeVendor) || VENDORS[0],
		[activeVendor]
	);

	// Single-line, OS-appropriate-joiner command so the snippet
	// copy-pastes into one shell invocation — matches the
	// Lapdog-style brevity the team asked for. The three logical
	// steps (install the CLI, persist endpoint+API key to
	// ~/.config/openlit/config.env via `configure`, then wire the
	// vendor hooks) all still need to run; chaining them keeps the
	// failure semantics tight without forcing three separate pastes.
	//
	// We invoke openlit by its full path on Linux/Windows because
	// the install step's PATH update doesn't reach the current
	// shell — only NEW shells pick it up. See bootstrapForOs for
	// the per-OS reasoning.
	const snippet = useMemo(() => {
		const apiKeyValue = firstKey || API_KEY_PLACEHOLDER;
		const { install, activate, joiner } = bootstrapForOs(activeOs);
		return [
			install,
			activate,
			`openlit configure --endpoint "${otlpEndpoint}" --api-key "${apiKeyValue}"`,
			`openlit coding install --vendor=${vendor.cliFlag}`,
		]
			.filter(Boolean)
			.join(joiner);
	}, [firstKey, otlpEndpoint, vendor, activeOs]);

	const handleCopy = () => {
		copy(snippet);
		setCopied(true);
	};

	const handleGenerateKey = useCallback(() => {
		toast.loading("Generating API key…", { id: "coding-agents-api-key" });
		createKey({
			requestType: "POST",
			url: "/api/api-key",
			body: JSON.stringify({ name: GENERATED_API_KEY_NAME }),
			successCb: () => {
				toast.success("API key created — pre-filled into the snippet.", {
					id: "coding-agents-api-key",
				});
				refreshKeys();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Could not generate API key", {
					id: "coding-agents-api-key",
				});
			},
		});
	}, [createKey, refreshKeys]);

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
					</div>
				)}

				{firstKey ? (
					<div className="flex items-start gap-3 mb-4 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30">
						<KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
						<p className="text-sm text-emerald-700 dark:text-emerald-300">
							Snippet is pre-filled with your API key and this
							dashboard&apos;s OTLP endpoint. The CLI will
							authenticate automatically.
						</p>
					</div>
				) : (
					<div className="flex items-start justify-between gap-3 mb-4 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<div className="flex items-start gap-3">
							<KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
							<p className="text-sm text-amber-700 dark:text-amber-300">
								No API key found. Generate one to pre-fill the
								snippet — the CLI needs it to authenticate
								OTLP exports.
							</p>
						</div>
						<button
							onClick={handleGenerateKey}
							disabled={isCreatingKey}
							className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed text-white transition-colors"
						>
							{isCreatingKey ? (
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
							) : (
								<KeyRound className="w-3.5 h-3.5" />
							)}
							Generate API key
						</button>
					</div>
				)}

				<div className="grid grid-cols-3 gap-2 mb-4">
					{OS_OPTIONS.map((os) => {
						const isActive = activeOs === os.id;
						const Icon = os.icon;
						return (
							<button
								key={os.id}
								onClick={() => setActiveOs(os.id)}
								className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border px-3 py-3 transition-colors ${
									isActive
										? "border-stone-900 dark:border-stone-100 bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100"
										: "border-stone-200 dark:border-stone-700 text-stone-500 dark:text-stone-400 hover:border-stone-300 dark:hover:border-stone-600 hover:text-stone-700 dark:hover:text-stone-300"
								}`}
							>
								<Icon className="w-5 h-5" />
								<span className="text-xs font-medium">{os.label}</span>
							</button>
						);
					})}
				</div>

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
							<pre className="text-xs font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap break-all pr-8 leading-relaxed">
								{snippet}
							</pre>
						</div>
						<div className="rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-3 text-xs text-stone-700 dark:text-stone-300">
							<p className="font-medium text-stone-900 dark:text-stone-100 mb-1.5">
								After running the snippet
							</p>
							<ol className="list-decimal pl-4 space-y-1">
								<li>{vendor.postInstall.restart}</li>
								{(vendor.postInstall.extraSteps || []).map((step, i) => (
									<li key={i}>{step}</li>
								))}
								<li>Send any prompt in {vendor.label}.</li>
							</ol>
						</div>

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
