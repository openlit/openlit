import { listAgents } from "@/lib/platform/agents";
import type { AgentListCursor, AgentListFilters, AgentSource } from "@/types/agents";
import { withCacheHeaders } from "./_cache";

const ALLOWED_SOURCES = new Set<AgentSource>(["controller", "sdk", "both"]);
const ALLOWED_STATUSES = new Set<NonNullable<AgentListFilters["statuses"]>[number]>([
	"discovered",
	"instrumented",
	"sdk",
]);

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

	const filters: AgentListFilters = {
		source: parseCsv(sp.get("source")).filter((v): v is AgentSource =>
			ALLOWED_SOURCES.has(v as AgentSource)
		),
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
