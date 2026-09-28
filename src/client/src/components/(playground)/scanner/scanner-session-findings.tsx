"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import FeatureAccess from "@/components/rbac/feature-access";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import getMessage from "@/constants/messages";
import { getRequestHeaders } from "@/utils/api";
import type { ScannerRepoFindingsResult } from "@/lib/platform/connectors/scanner/types";
import type { ScannerFinding } from "@/lib/platform/connectors/scanner/types";

function severityTone(severity: string): string {
	if (severity === "critical") {
		return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
	}
	if (severity === "high") {
		return "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300";
	}
	if (severity === "medium") {
		return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
	}
	if (severity === "info" || severity === "meta") {
		return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300";
	}
	return "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300";
}

function FindingRow({ finding }: { finding: ScannerFinding }) {
	const location = [finding.path, finding.line ? String(finding.line) : ""]
		.filter(Boolean)
		.join(":");
	const meta = [finding.ruleId, finding.scope || finding.category, location]
		.filter(Boolean)
		.join("  ·  ");
	return (
		<div className="flex items-start gap-3 border-b border-stone-100 px-1 py-2 last:border-b-0 dark:border-stone-900">
			<span
				className={`mt-0.5 inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${severityTone(finding.severity)}`}
			>
				{finding.severity}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-xs font-medium text-stone-900 dark:text-stone-100">
					{finding.title}
				</span>
				{meta ? (
					<span className="mt-0.5 block truncate font-mono text-[10px] text-stone-500 dark:text-stone-400">
						{meta}
					</span>
				) : null}
			</span>
		</div>
	);
}

export default function ScannerSessionFindings({ repoUrl }: { repoUrl: string }) {
	const messages = getMessage();
	const [result, setResult] = useState<ScannerRepoFindingsResult | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!repoUrl) {
			setResult(null);
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const response = await fetch(
					`/api/scanners/findings?repoUrl=${encodeURIComponent(repoUrl)}`,
					{ headers: getRequestHeaders() }
				);
				const body = await response.json();
				if (!response.ok) {
					throw new Error(body?.err || messages.SCANNER_FINDINGS_LOAD_FAILED);
				}
				if (!cancelled) setResult(body as ScannerRepoFindingsResult);
			} catch (cause) {
				if (!cancelled) {
					setError(
						cause instanceof Error
							? cause.message
							: messages.SCANNER_FINDINGS_LOAD_FAILED
					);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [messages.SCANNER_FINDINGS_LOAD_FAILED, repoUrl]);

	return (
		<FeatureAccess access="scanner.read" hideWhenDenied>
			<div className="flex min-h-0 flex-col gap-2">
				{loading ? (
					<div className="space-y-2">
						<Skeleton className="h-4 w-48" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-10 w-full" />
					</div>
				) : error ? (
					<p className="text-xs text-stone-500 dark:text-stone-400">{error}</p>
				) : result?.matched ? (
					<>
						<div className="flex items-center justify-between gap-2">
							<p className="text-xs text-stone-600 dark:text-stone-400">
								{result.findingCount > 0
									? messages.SCANNER_SESSION_SUMMARY(
											result.mediumPlusCount,
											result.findingCount
										)
									: messages.SCANNER_SESSION_CLEAN}
							</p>
							<Button asChild variant="outline" size="sm" className="h-7 px-2 text-[11px]">
								<Link href={result.url}>{messages.SCANNER_SESSION_OPEN}</Link>
							</Button>
						</div>
						{result.findings.length ? (
							<div className="min-h-0 overflow-auto">
								{result.findings.map((finding) => (
									<FindingRow key={finding.id} finding={finding} />
								))}
							</div>
						) : null}
					</>
				) : (
					<div className="flex items-center justify-between gap-2">
						<p className="text-xs text-stone-500 dark:text-stone-400">
							{messages.SCANNER_SESSION_EMPTY}
						</p>
						<Button asChild variant="outline" size="sm" className="h-7 px-2 text-[11px]">
							<Link href={result?.url || "/scanner"}>
								{messages.SCANNER_SESSION_OPEN}
							</Link>
						</Button>
					</div>
				)}
			</div>
		</FeatureAccess>
	);
}
