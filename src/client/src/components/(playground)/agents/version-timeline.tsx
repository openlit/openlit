"use client";

import {
	useEffect,
	useMemo,
	useState,
	useCallback,
} from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { formatBrowserDateTime } from "@/utils/date";
import getMessage from "@/constants/messages";
import type { AgentVersion } from "@/types/agents";

/**
 * Reads `/api/agents/[agentKey]/versions/timeline` once per agentKey + window
 * and renders a thin stacked-bar chart colored per version (palette below).
 * The version chooser dropdown is a separate `<VersionChooser />` export so
 * the page can place it inline with the title while the bar chart spans the
 * full content width.
 */

interface TimelineBucket {
	ts: string;
	versionHash: string;
	requests: number;
}

interface TimelineResponse {
	bucketSeconds: number;
	start: string;
	end: string;
	buckets: TimelineBucket[];
}

interface VersionTimelineProps {
	agentKey: string;
	versions: AgentVersion[];
	selectedHash: string | null;
	bucketPreset?: "15m" | "1h" | "6h" | "1d";
	windowHours?: number;
}

interface VersionChooserProps {
	versions: AgentVersion[];
	selectedHash: string | null;
	onSelectVersion: (hash: string | null) => void;
	onOpenAllVersions: () => void;
}

// On-brand orange palette — distinct shades within the OpenLit primary
// (#F36C06) family so multi-version bars stay readable while feeling
// consistent with the rest of the product.
const VERSION_PALETTE = [
	"#F36C06", // primary
	"#c2410c", // orange-700
	"#ea580c", // orange-600
	"#f59e0b", // amber-500
	"#9a3412", // orange-800
	"#fb923c", // orange-400
	"#d97706", // amber-600
	"#7c2d12", // orange-900
	"#fdba74", // orange-300
	"#b45309", // amber-700
	"#92400e", // amber-800
	"#fcd34d", // amber-300
];

function colorForHash(hash: string, idx: number): string {
	if (!hash) return "#a8a29e"; // stone-400 for unattributed buckets
	return VERSION_PALETTE[idx % VERSION_PALETTE.length];
}

export default function VersionTimeline({
	agentKey,
	versions,
	selectedHash,
	bucketPreset = "1h",
	windowHours = 24 * 7,
}: VersionTimelineProps) {
	const [data, setData] = useState<TimelineResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const params = new URLSearchParams({
					bucket: bucketPreset,
					windowHours: String(windowHours),
				});
				const res = await fetch(
					`/api/agents/${agentKey}/versions/timeline?${params.toString()}`
				);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const body = await res.json();
				if (cancelled) return;
				setData(body.data as TimelineResponse);
			} catch (e) {
				if (!cancelled) setError(String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [agentKey, bucketPreset, windowHours]);

	// Build a stable per-version index so palette assignment doesn't shift
	// when timeline buckets re-fetch.
	const versionIndex = useMemo(() => {
		const ordered = [...versions].sort(
			(a, b) => a.version_number - b.version_number
		);
		const map = new Map<string, number>();
		ordered.forEach((v, i) => map.set(v.version_hash, i));
		return map;
	}, [versions]);

	const groupedByTs = useMemo(() => {
		if (!data) return [];
		const tsMap = new Map<string, Map<string, number>>();
		for (const b of data.buckets) {
			let inner = tsMap.get(b.ts);
			if (!inner) {
				inner = new Map();
				tsMap.set(b.ts, inner);
			}
			inner.set(b.versionHash, (inner.get(b.versionHash) || 0) + b.requests);
		}
		return Array.from(tsMap.entries())
			.map(([ts, vmap]) => ({
				ts,
				slices: Array.from(vmap.entries()).map(([versionHash, requests]) => ({
					versionHash,
					requests,
				})),
				total: Array.from(vmap.values()).reduce((a, b) => a + b, 0),
			}))
			.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
	}, [data]);

	const maxTotal = useMemo(
		() => groupedByTs.reduce((m, b) => Math.max(m, b.total), 0) || 1,
		[groupedByTs]
	);

	return (
		<div className="h-[40px] w-full">
			{loading && (
				<div className="h-full flex items-center text-xs text-stone-500 dark:text-stone-400">
					Loading…
				</div>
			)}
			{!loading && error && (
				<div className="h-full flex items-center text-xs text-red-600 dark:text-red-400">
					{error}
				</div>
			)}
			{!loading && !error && groupedByTs.length === 0 && (
				<div className="h-full flex items-center text-xs text-stone-500 dark:text-stone-400">
					{getMessage().AGENTS_VERSION_TIMELINE_EMPTY}
				</div>
			)}
			{!loading && !error && groupedByTs.length > 0 && (
				<svg
					viewBox={`0 0 ${groupedByTs.length * 6} 40`}
					preserveAspectRatio="none"
					className="h-full w-full"
					aria-label={getMessage().AGENTS_VERSION_TIMELINE_TITLE}
				>
					{groupedByTs.map((bucket, bIdx) => {
						let yCursor = 40;
						return (
							<g key={bucket.ts} transform={`translate(${bIdx * 6}, 0)`}>
								{bucket.slices.map((slice) => {
									const idx = versionIndex.get(slice.versionHash) ?? -1;
									const fill = colorForHash(slice.versionHash, idx);
									const heightPx = (slice.requests / maxTotal) * 38;
									yCursor -= heightPx;
									const opacity =
										!selectedHash || selectedHash === slice.versionHash
											? 1
											: 0.18;
									return (
										<rect
											key={`${bucket.ts}-${slice.versionHash}`}
											x={0.5}
											y={yCursor}
											width={5}
											height={Math.max(0.5, heightPx)}
											fill={fill}
											opacity={opacity}
										>
											<title>
												{`${formatBrowserDateTime(bucket.ts)}\n${
													getMessage().AGENTS_VERSION_TIMELINE_REQ_COUNT(
														slice.requests
													)
												}\n${
													versions.find(
														(v) => v.version_hash === slice.versionHash
													)?.version_hash?.slice(0, 8) || "—"
												}`}
											</title>
										</rect>
									);
								})}
							</g>
						);
					})}
				</svg>
			)}
		</div>
	);
}

/**
 * Compact version chooser dropdown. Rendered inline with the agent title so
 * the bar chart can take the full content width.
 */
export function VersionChooser({
	versions,
	selectedHash,
	onSelectVersion,
	onOpenAllVersions,
}: VersionChooserProps) {
	const handleSelectChange = useCallback(
		(value: string) => {
			if (value === "__all__") {
				onSelectVersion(null);
				return;
			}
			if (value === "__more__") {
				onOpenAllVersions();
				return;
			}
			onSelectVersion(value);
		},
		[onSelectVersion, onOpenAllVersions]
	);

	return (
		<Select value={selectedHash || "__all__"} onValueChange={handleSelectChange}>
			<SelectTrigger className="h-8 text-xs min-w-[200px]">
				<SelectValue
					placeholder={getMessage().AGENTS_VERSION_TIMELINE_ALL_VERSIONS}
				/>
			</SelectTrigger>
			<SelectContent className="max-h-[300px]">
				<SelectItem value="__all__">
					{getMessage().AGENTS_VERSION_TIMELINE_ALL_VERSIONS}
				</SelectItem>
				{versions.map((v) => (
					<SelectItem key={v.version_hash} value={v.version_hash}>
						<span className="font-medium">
							{getMessage().AGENTS_VERSION_NUMBER_PREFIX}
							{v.version_number}
						</span>
						<span className="ml-2 font-mono text-stone-500">
							{v.version_hash.slice(0, 8)}
						</span>
					</SelectItem>
				))}
				{versions.length > 0 && (
					<SelectItem value="__more__">View all versions…</SelectItem>
				)}
			</SelectContent>
		</Select>
	);
}

export { VERSION_PALETTE, colorForHash };
