"use client";

import { useMemo, useState } from "react";
import {
	AlertTriangle,
	Bot,
	BrainCircuit,
	CheckCircle2,
	CircleDollarSign,
	Clock3,
	Code2,
	GitMerge,
	GitPullRequest,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	Users,
	Wrench,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AudienceTab = "me" | "sessions" | "health" | "spend" | "tools" | "settings";

const scorecard = [
	{
		label: "Acceptance",
		value: "71.4%",
		detail: "Telemetry-only",
		trend: "+4.2%",
		icon: CheckCircle2,
	},
	{
		label: "Merge",
		value: "62.8%",
		detail: "Outcome-joined",
		trend: "+1.8%",
		icon: GitMerge,
	},
	{
		label: "Survival 30d",
		value: "48.9%",
		detail: "AI lines retained",
		trend: "-2.1%",
		icon: ShieldCheck,
	},
	{
		label: "Rework 7d",
		value: "18.6%",
		detail: "Lower is better",
		trend: "-3.4%",
		icon: RefreshCw,
	},
	{
		label: "Incident attribution",
		value: "2.3%",
		detail: "Tagged incidents",
		trend: "-0.6%",
		icon: AlertTriangle,
	},
	{
		label: "Cost / merged line",
		value: "$0.041",
		detail: "Token spend joined to PRs",
		trend: "-8.0%",
		icon: CircleDollarSign,
	},
];

const sessions = [
	{
		id: "ses_8f31",
		user: "You",
		agent: "Claude Code",
		model: "claude-sonnet-4.5",
		repo: "openlit/openlit",
		duration: "42m",
		turns: 18,
		cost: "$3.42",
		outcome: "PR merged",
		classification: "work",
	},
	{
		id: "ses_92ca",
		user: "You",
		agent: "Codex",
		model: "gpt-5.3-codex",
		repo: "openlit/openlit",
		duration: "16m",
		turns: 9,
		cost: "$1.08",
		outcome: "Commit only",
		classification: "work",
	},
	{
		id: "ses_114b",
		user: "Team cohort",
		agent: "Cursor",
		model: "auto",
		repo: "connected repos",
		duration: "n=3 hidden",
		turns: 0,
		cost: "k-gated",
		outcome: "Below k=5",
		classification: "private",
	},
];

const repoRows = [
	{
		repo: "openlit/openlit",
		vendor: "Claude Code",
		sessions: 128,
		cost: "$412",
		mergedLines: "10,124",
		survival: "51%",
		rework: "16%",
	},
	{
		repo: "platform/api",
		vendor: "Cursor",
		sessions: 84,
		cost: "$265",
		mergedLines: "6,482",
		survival: "46%",
		rework: "22%",
	},
	{
		repo: "growth/web",
		vendor: "Codex",
		sessions: 57,
		cost: "$119",
		mergedLines: "2,771",
		survival: "44%",
		rework: "19%",
	},
];

const tools = [
	{ name: "edit", kind: "builtin", calls: "18.2k", success: "94%", cost: "$148" },
	{ name: "bash", kind: "builtin", calls: "11.7k", success: "89%", cost: "$96" },
	{ name: "github", kind: "mcp", calls: "4.9k", success: "91%", cost: "$38" },
	{ name: "semgrep", kind: "custom", calls: "1.3k", success: "87%", cost: "$12" },
];

const setupItems = [
	{
		title: "Hook installer",
		body: "One openlit-coding-hook binary writes Claude Code, Cursor, and Codex hooks and emits normalized OTLP spans.",
		icon: Bot,
	},
	{
		title: "GitHub App",
		body: "PRs, commits, diffs, blame, and review events join telemetry to merge, survival, and rework metrics.",
		icon: GitPullRequest,
	},
	{
		title: "Privacy gates",
		body: "Developer-level views stay k-gated for teams, while ICs can inspect their own sessions and classifications.",
		icon: Users,
	},
];

export default function CodingAgentsPage() {
	const [activeTab, setActiveTab] = useState<AudienceTab>("health");

	const telemetrySummary = useMemo(
		() => [
			{ label: "Sessions", value: "1,842", icon: BrainCircuit },
			{ label: "Tool calls", value: "36.1k", icon: Wrench },
			{ label: "Subagents", value: "428", icon: Sparkles },
			{ label: "Loop alerts", value: "14", icon: AlertTriangle },
		],
		[]
	);

	return (
		<div className="flex flex-col w-full gap-5 p-1 overflow-y-auto pb-8">
			<section className="border border-stone-200 dark:border-stone-800 rounded-lg bg-white dark:bg-stone-950">
				<div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
					<div className="space-y-2">
						<div className="inline-flex items-center gap-2 text-xs font-medium text-stone-500 dark:text-stone-400">
							<Code2 className="h-4 w-4" />
							Coding Agents Observability
						</div>
						<div>
							<h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-50">
								Agent Scorecard
							</h1>
							<p className="mt-1 max-w-3xl text-sm text-stone-500 dark:text-stone-400">
								Track Claude Code, Cursor, Codex, and Copilot from
								session telemetry through commits, PRs, merged lines, and
								security findings.
							</p>
						</div>
					</div>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
						{telemetrySummary.map((item) => {
							const Icon = item.icon;
							return (
								<div
									key={item.label}
									className="rounded-md border border-stone-200 dark:border-stone-800 p-3"
								>
									<div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
										<Icon className="h-3.5 w-3.5" />
										{item.label}
									</div>
									<div className="mt-1 text-lg font-semibold text-stone-950 dark:text-stone-50">
										{item.value}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</section>

			<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AudienceTab)}>
				<TabsList className="h-auto rounded-none border-b border-stone-200 dark:border-stone-800 bg-transparent p-0 w-full justify-start gap-1 overflow-x-auto">
					<NavTab value="me" label="My Sessions" />
					<NavTab value="sessions" label="All Sessions" />
					<NavTab value="health" label="Health" />
					<NavTab value="spend" label="Spend" />
					<NavTab value="tools" label="Tools / MCPs" />
					<NavTab value="settings" label="Setup" />
				</TabsList>

				<TabsContent value="health" className="mt-5 space-y-5">
					<section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
						{scorecard.map((metric) => (
							<ScorecardMetric key={metric.label} metric={metric} />
						))}
					</section>
					<section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
						<RepoTable />
						<MetricTiers />
					</section>
				</TabsContent>

				<TabsContent value="me" className="mt-5">
					<SessionsTable title="My recent sessions" rows={sessions.filter((row) => row.user === "You")} />
				</TabsContent>

				<TabsContent value="sessions" className="mt-5">
					<SessionsTable title="Team sessions with privacy floor" rows={sessions} />
				</TabsContent>

				<TabsContent value="spend" className="mt-5 space-y-4">
					<SpendOverview />
					<RepoTable />
				</TabsContent>

				<TabsContent value="tools" className="mt-5">
					<ToolsTable />
				</TabsContent>

				<TabsContent value="settings" className="mt-5">
					<SetupPanel />
				</TabsContent>
			</Tabs>
		</div>
	);
}

function NavTab({ value, label }: { value: AudienceTab; label: string }) {
	return (
		<TabsTrigger
			value={value}
			className="rounded-none border-b-2 border-transparent bg-transparent shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-stone-900 dark:data-[state=active]:text-stone-100 data-[state=active]:shadow-none px-3 py-2 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 -mb-px"
		>
			{label}
		</TabsTrigger>
	);
}

function ScorecardMetric({
	metric,
}: {
	metric: (typeof scorecard)[number];
}) {
	const Icon = metric.icon;
	const positive = !metric.trend.startsWith("-");
	return (
		<div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">
						{metric.label}
					</div>
					<div className="text-2xl font-semibold text-stone-950 dark:text-stone-50">
						{metric.value}
					</div>
				</div>
				<div className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300">
					<Icon className="h-4 w-4" />
				</div>
			</div>
			<div className="mt-3 flex items-center justify-between gap-2 text-xs">
				<span className="text-stone-500 dark:text-stone-400">{metric.detail}</span>
				<span className={positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
					{metric.trend}
				</span>
			</div>
		</div>
	);
}

function SessionsTable({
	title,
	rows,
}: {
	title: string;
	rows: typeof sessions;
}) {
	return (
		<section className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
			<div className="flex items-center justify-between gap-3 border-b border-stone-200 dark:border-stone-800 px-4 py-3">
				<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
					{title}
				</h2>
				<div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
					<Clock3 className="h-3.5 w-3.5" />
					Most recent first
				</div>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-stone-50 text-xs text-stone-500 dark:bg-stone-900/50 dark:text-stone-400">
						<tr>
							<TableHead>Session</TableHead>
							<TableHead>Agent</TableHead>
							<TableHead>Repo</TableHead>
							<TableHead>Duration</TableHead>
							<TableHead>Turns</TableHead>
							<TableHead>Cost</TableHead>
							<TableHead>Outcome</TableHead>
							<TableHead>Class</TableHead>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} className="border-t border-stone-100 dark:border-stone-800">
								<TableCell>
									<div className="font-medium text-stone-950 dark:text-stone-50">
										{row.id}
									</div>
									<div className="text-xs text-stone-500 dark:text-stone-400">
										{row.user}
									</div>
								</TableCell>
								<TableCell>
									<div>{row.agent}</div>
									<div className="text-xs text-stone-500 dark:text-stone-400">
										{row.model}
									</div>
								</TableCell>
								<TableCell>{row.repo}</TableCell>
								<TableCell>{row.duration}</TableCell>
								<TableCell>{row.turns || "-"}</TableCell>
								<TableCell>{row.cost}</TableCell>
								<TableCell>{row.outcome}</TableCell>
								<TableCell>
									<span className="rounded-md border border-stone-200 px-2 py-0.5 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300">
										{row.classification}
									</span>
								</TableCell>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function RepoTable() {
	return (
		<section className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
			<div className="border-b border-stone-200 dark:border-stone-800 px-4 py-3">
				<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
					Repository outcomes
				</h2>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-stone-50 text-xs text-stone-500 dark:bg-stone-900/50 dark:text-stone-400">
						<tr>
							<TableHead>Repository</TableHead>
							<TableHead>Top vendor</TableHead>
							<TableHead>Sessions</TableHead>
							<TableHead>Spend</TableHead>
							<TableHead>Merged lines</TableHead>
							<TableHead>Survival</TableHead>
							<TableHead>Rework</TableHead>
						</tr>
					</thead>
					<tbody>
						{repoRows.map((row) => (
							<tr key={row.repo} className="border-t border-stone-100 dark:border-stone-800">
								<TableCell className="font-medium text-stone-950 dark:text-stone-50">
									{row.repo}
								</TableCell>
								<TableCell>{row.vendor}</TableCell>
								<TableCell>{row.sessions}</TableCell>
								<TableCell>{row.cost}</TableCell>
								<TableCell>{row.mergedLines}</TableCell>
								<TableCell>{row.survival}</TableCell>
								<TableCell>{row.rework}</TableCell>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function MetricTiers() {
	return (
		<section className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
			<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
				Metric coverage
			</h2>
			<div className="mt-4 space-y-4">
				<TierRow title="Telemetry-only" value="Always available" items="Sessions, acceptance, cost, tools, MCPs, loops, model mix" />
				<TierRow title="Outcome-joined" value="GitHub App required" items="Merge, survival, rework, incidents, cost per merged line" />
				<TierRow title="Privacy floor" value="k=5" items="Team views hide cohorts below threshold; IC views show only the signed-in developer." />
			</div>
		</section>
	);
}

function TierRow({
	title,
	value,
	items,
}: {
	title: string;
	value: string;
	items: string;
}) {
	return (
		<div className="border-l-2 border-stone-300 pl-3 dark:border-stone-700">
			<div className="flex items-center justify-between gap-3">
				<div className="text-sm font-medium text-stone-950 dark:text-stone-50">
					{title}
				</div>
				<div className="text-xs text-stone-500 dark:text-stone-400">
					{value}
				</div>
			</div>
			<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
				{items}
			</p>
		</div>
	);
}

function SpendOverview() {
	return (
		<section className="grid grid-cols-1 gap-3 md:grid-cols-3">
			<CompactMetric label="Monthly spend" value="$8,420" detail="Across coding agents" />
			<CompactMetric label="SSO org spend" value="86%" detail="Classified as work" />
			<CompactMetric label="BYOK spend" value="14%" detail="Needs review by policy" />
		</section>
	);
}

function CompactMetric({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4">
			<div className="text-xs font-medium uppercase text-stone-500 dark:text-stone-400">
				{label}
			</div>
			<div className="mt-1 text-2xl font-semibold text-stone-950 dark:text-stone-50">
				{value}
			</div>
			<div className="mt-1 text-xs text-stone-500 dark:text-stone-400">
				{detail}
			</div>
		</div>
	);
}

function ToolsTable() {
	return (
		<section className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
			<div className="border-b border-stone-200 dark:border-stone-800 px-4 py-3">
				<h2 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
					Tool and MCP usage
				</h2>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead className="bg-stone-50 text-xs text-stone-500 dark:bg-stone-900/50 dark:text-stone-400">
						<tr>
							<TableHead>Tool</TableHead>
							<TableHead>Kind</TableHead>
							<TableHead>Calls</TableHead>
							<TableHead>Success</TableHead>
							<TableHead>Cost</TableHead>
						</tr>
					</thead>
					<tbody>
						{tools.map((tool) => (
							<tr key={tool.name} className="border-t border-stone-100 dark:border-stone-800">
								<TableCell className="font-medium text-stone-950 dark:text-stone-50">
									{tool.name}
								</TableCell>
								<TableCell>{tool.kind}</TableCell>
								<TableCell>{tool.calls}</TableCell>
								<TableCell>{tool.success}</TableCell>
								<TableCell>{tool.cost}</TableCell>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function SetupPanel() {
	return (
		<section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
			{setupItems.map((item) => {
				const Icon = item.icon;
				return (
					<div
						key={item.title}
						className="rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-4"
					>
						<div className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 dark:border-stone-800 text-stone-600 dark:text-stone-300">
							<Icon className="h-4 w-4" />
						</div>
						<h2 className="mt-4 text-sm font-semibold text-stone-950 dark:text-stone-50">
							{item.title}
						</h2>
						<p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
							{item.body}
						</p>
					</div>
				);
			})}
		</section>
	);
}

function TableHead({ children }: { children: React.ReactNode }) {
	return <th className="px-4 py-2 text-left font-medium">{children}</th>;
}

function TableCell({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return <td className={`px-4 py-3 text-stone-700 dark:text-stone-300 ${className}`}>{children}</td>;
}
