import { listAgents } from "@/lib/platform/agents";
import type { AgentListCursor, AgentListFilters, AgentSource } from "@/types/agents";
import { withCacheHeaders } from "./_cache";

// "coding" is intentionally allowed here so the Coding Agents tab can
// pass `?source=coding` and read its rows out of the same endpoint.
// Default behaviour (no `source` param) excludes coding rows below so
// they can't leak into the Applications tab even for one render frame.
const ALLOWED_SOURCES = new Set<AgentSource>(["controller", "sdk", "both", "coding"]);
const ALLOWED_STATUSES = new Set<NonNullable<AgentListFilters["statuses"]>[number]>([
	"discovered",
	"instrumented",
	"sdk",
]);
const APPLICATION_SOURCES: AgentSource[] = ["controller", "sdk", "both"];

function parseCsv(value: string | null): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const sp = url.searchParams;

	const cursorRaw = sp.get("cursor");
	let cursor: AgentListCursor | null = null;
	if (cursorRaw) {
		try {
			const parsed = JSON.parse(
				Buffer.from(cursorRaw, "base64").toString("utf-8")
			);
			if (
				parsed &&
				typeof parsed.last_seen === "string" &&
				typeof parsed.agent_key === "string"
			) {
				cursor = { last_seen: parsed.last_seen, agent_key: parsed.agent_key };
			}
		} catch {
			return Response.json({ error: "Invalid cursor" }, { status: 400 });
		}
	}

	const limitRaw = sp.get("limit");
	const limit = limitRaw ? Number(limitRaw) : undefined;
	if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
		return Response.json({ error: "Invalid limit" }, { status: 400 });
	}

	// When the caller doesn't pin a `source`, we exclude coding rows
	// from the result so the Applications tab is never racy against
	// the materializer (a brief moment where a freshly inserted coding
	// row showed up in Apps before the client-side split filtered it
	// out was the bug that motivated this change). The Coding Agents
	// tab opts in via ?source=coding.
	const sourceFilter = parseCsv(sp.get("source")).filter((v): v is AgentSource =>
		ALLOWED_SOURCES.has(v as AgentSource)
	);
	const filters: AgentListFilters = {
		source: sourceFilter.length > 0 ? sourceFilter : APPLICATION_SOURCES,
		environments: parseCsv(sp.get("environments")),
		providers: parseCsv(sp.get("providers")),
		statuses: parseCsv(sp.get("statuses")).filter((v): v is NonNullable<AgentListFilters["statuses"]>[number] =>
			ALLOWED_STATUSES.has(v as never)
		),
	};

	const result = await listAgents({
		timeStart: sp.get("start") || undefined,
		timeEnd: sp.get("end") || undefined,
		cursor,
		limit,
		filters,
	});

	const encodedNext = result.nextCursor
		? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64")
		: null;

	return withCacheHeaders(
		{ data: result.data, nextCursor: encodedNext },
		"list"
	);
}
