import { POLICY_VERSIONS, swr } from "@/lib/platform/agents/cache";
import {
	getVersionTimeline,
	_bucketPresets,
} from "@/lib/platform/agents/snapshot";
import { withCacheHeaders } from "../../../_cache";

/**
 * GET /api/agents/[agentKey]/versions/timeline
 *
 * Query params:
 *   - `bucket` (preset name e.g. `1h`, `15m`, `1d`) — granularity
 *   - `bucketSeconds` (raw integer override)
 *   - `windowHours` (lookback, default 168 / 7d)
 *
 * Response:
 *   { data: { bucketSeconds, start, end, buckets: [{ts, versionHash, requests}] } }
 *
 * Buckets without a stamped `openlit.agent.version_hash` are attributed to
 * the most recent version whose `first_seen` <= bucket — see
 * `getVersionTimeline` for the hybrid attribution logic.
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ agentKey: string }> }
) {
	const { agentKey } = await params;
	const url = new URL(request.url);

	let bucketSeconds = 60 * 60;
	const bucketPreset = url.searchParams.get("bucket");
	if (bucketPreset && _bucketPresets[bucketPreset]) {
		bucketSeconds = _bucketPresets[bucketPreset];
	}
	const bucketSecondsRaw = url.searchParams.get("bucketSeconds");
	if (bucketSecondsRaw) {
		const parsed = Number(bucketSecondsRaw);
		if (Number.isFinite(parsed) && parsed >= 60 && parsed <= 60 * 60 * 24 * 7) {
			bucketSeconds = Math.floor(parsed);
		}
	}

	let windowHours = 24 * 7;
	const windowHoursRaw = url.searchParams.get("windowHours");
	if (windowHoursRaw) {
		const parsed = Number(windowHoursRaw);
		if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 24 * 90) {
			windowHours = Math.floor(parsed);
		}
	}

	const cacheKey = `agents:versions:timeline:default:${agentKey}:${bucketSeconds}:${windowHours}`;
	const data = await swr(cacheKey, POLICY_VERSIONS, () =>
		getVersionTimeline(agentKey, { bucketSeconds, windowHours })
	);
	return withCacheHeaders({ data }, "timeline");
}
