"use client";

/**
 * Sessions tab for the coding-agent detail page. Lists recent
 * `coding_agent.session.id` sessions for the selected vendor with
 * tokens / cost / outcome / classification, paginated server-side.
 *
 * Row click opens the standard request-detail sheet (reused from the
 * monitoring tab) so users can see the full span tree without leaving
 * the page.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import getMessage from "@/constants/messages";
import type { UnifiedAgent } from "@/types/agents";
import {
	type CodingAgentClassification,
	isCodingAgentClassification,
} from "@/lib/platform/coding-agents/classifier";

const CodingSessionDetailSheet = dynamic(
	() => import("./coding-session-detail-sheet"),
	{ ssr: false }
);

interface CodingSession {
	session_id: string;
	user: string;
	started_at: string;
	ended_at: string;
	duration_ms: number;
	tool_call_count: number;
	subagent_count: number;
	cost_usd: number;
	outcome: string;
	classification: string;
	classification_reason: string;
	repo_url: string;
}

interface CodingSessionsTabProps {
	agent: UnifiedAgent;
}

export default function CodingSessionsTab({ agent }: CodingSessionsTabProps) {
	const [rows, setRows] = useState<CodingSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [openSessionId, setOpenSessionId] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		(async () => {
			try {
				const params = new URLSearchParams();
				if (agent.coding_agent_vendor) {
					params.set("vendor", agent.coding_agent_vendor);
				}
				const res = await fetch(`/api/coding-agents/sessions?${params}`);
				if (cancelled) return;
				if (!res.ok) {
					setError(`HTTP ${res.status}`);
					setRows([]);
					return;
				}
				const body = await res.json();
				setRows((body.data as CodingSession[]) || []);
				setError(null);
			} catch (e) {
				if (!cancelled) setError(String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [agent.agent_key, agent.coding_agent_vendor]);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-12 text-sm text-stone-500 dark:text-stone-400 gap-2">
				<Loader2 className="w-4 h-4 animate-spin" />
				{getMessage().AGENTS_LOADING_REQUESTS}
			</div>
		);
	}

	if (error) {
		return (
			<div className="border border-red-200 dark:border-red-900/50 rounded-lg p-6 text-sm text-red-700 dark:text-red-400">
				{error}
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div className="border dark:border-stone-800 rounded-lg p-6 text-sm text-stone-500 dark:text-stone-400">
				{getMessage().AGENTS_CODING_SESSIONS_EMPTY}
			</div>
		);
	}

	return (
		<>
			<div className="border dark:border-stone-800 rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-stone-50 dark:bg-stone-900/40 text-left text-xs uppercase text-stone-500 dark:text-stone-400">
						<tr>
							<th className="p-3">Session</th>
							<th className="p-3">User</th>
							<th className="p-3">Started</th>
							<th className="p-3">Duration</th>
							<th className="p-3">Tools</th>
							<th className="p-3">Cost</th>
							<th className="p-3">Outcome</th>
							<th className="p-3">Class</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr
								key={r.session_id}
								onClick={() => setOpenSessionId(r.session_id)}
								className="border-t border-stone-100 dark:border-stone-800/60 hover:bg-stone-50 dark:hover:bg-stone-900/30 cursor-pointer"
							>
								<td className="p-3 font-mono text-xs text-primary">
									{r.session_id.slice(0, 12)}
								</td>
								<td className="p-3">{r.user || "—"}</td>
								<td className="p-3">{formatDate(r.started_at)}</td>
								<td className="p-3">
									{r.duration_ms > 0
										? `${(r.duration_ms / 1000).toFixed(1)}s`
										: "—"}
								</td>
								<td className="p-3">{r.tool_call_count.toLocaleString()}</td>
								<td className="p-3">${r.cost_usd.toFixed(4)}</td>
								<td className="p-3">
									<OutcomePill outcome={r.outcome} />
								</td>
								<td className="p-3" onClick={(e) => e.stopPropagation()}>
									<div className="flex items-center gap-2">
										<ClassPill
											value={r.classification}
											reason={r.classification_reason}
										/>
										{r.classification &&
										r.classification !== "disputed" ? (
											<DisputeButton
												sessionId={r.session_id}
												currentClassification={
													isCodingAgentClassification(r.classification)
														? r.classification
														: "unknown"
												}
											/>
										) : null}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<CodingSessionDetailSheet
				sessionId={openSessionId}
				onClose={() => setOpenSessionId(null)}
			/>
		</>
	);
}

function OutcomePill({ outcome }: { outcome: string }) {
	const color = outcomeColor(outcome);
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}
		>
			{outcome || "—"}
		</span>
	);
}

function outcomeColor(outcome: string): string {
	switch (outcome) {
		case "merged":
		case "committed":
			return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
		case "abandoned_no_change":
		case "cancelled":
			return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
		case "abandoned_with_change":
			return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
		default:
			return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
	}
}

function ClassPill({ value, reason }: { value: string; reason: string }) {
	const color =
		value === "work"
			? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
			: value === "personal"
				? "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
				: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}
			title={reason || undefined}
		>
			{value || "unknown"}
		</span>
	);
}

function formatDate(input: string): string {
	if (!input) return "—";
	const d = new Date(input);
	if (Number.isNaN(d.getTime())) return input;
	return d.toLocaleString();
}

/**
 * Lightweight dispute affordance. Opens a native prompt for the
 * rationale (we'll upgrade to a Dialog component once the classification
 * detail drawer ships in v1.1) and POSTs to /api/coding-agents/classification/dispute.
 *
 * Optimistic UI: on success we flip the row's classification badge to
 * 'disputed' through a state-bumper passed back via callback. For now,
 * we just rely on next refresh to pick up the new state.
 */
function DisputeButton({
	sessionId,
	currentClassification,
}: {
	sessionId: string;
	currentClassification: CodingAgentClassification;
}) {
	const [submitting, setSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const targetLabel =
		currentClassification === "work"
			? "personal"
			: currentClassification === "personal"
				? "work"
				: "work";

	async function dispute() {
		const rationale = window.prompt(
			`Mark this session as ${targetLabel} instead of ${currentClassification}? Add a short rationale (4-1000 chars):`
		);
		if (!rationale || rationale.trim().length < 4) return;
		setSubmitting(true);
		setError(null);
		try {
			const res = await fetch("/api/coding-agents/classification/dispute", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId,
					currentClassification,
					requestedClassification: targetLabel,
					rationale: rationale.trim(),
				}),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				setError(body?.error || `HTTP ${res.status}`);
				return;
			}
			setSubmitted(true);
		} catch (e) {
			setError(String(e));
		} finally {
			setSubmitting(false);
		}
	}

	if (submitted) {
		return (
			<span className="text-xs text-emerald-600 dark:text-emerald-400">
				Dispute filed
			</span>
		);
	}

	return (
		<button
			type="button"
			onClick={dispute}
			disabled={submitting}
			className="text-xs text-stone-500 dark:text-stone-400 underline-offset-2 hover:underline disabled:opacity-50"
			title={error || "Dispute this auto-classification"}
		>
			{submitting ? "…" : "Dispute"}
		</button>
	);
}
