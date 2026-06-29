/**
 * /api/coding-agents/users
 *
 * Org-wide directory of coding-agent users. Two transports:
 *   - GET: simple paginated read (limit/offset query params).
 *   - POST: the same body shape `<ObservabilitySignalList>` sends,
 *     returning `{ records, total }` — used by the new "Users" tab on
 *     the coding-agent detail page.
 *
 * Privacy: rows below `COHORT_K_FLOOR` collapse into a single
 * `low_cohort` aggregate for non-admin callers. See `listCodingUsers`.
 */

import {
	requireCodingAgentAuth,
	CodingAgentUnauthorizedError,
} from "@/lib/platform/coding-agents/auth";
import {
	listCodingUsers,
	type CodingUsersSortBy,
	type ListCodingUsersOptions,
} from "@/lib/platform/coding-agents/queries";

const VALID_SORT_BY: CodingUsersSortBy[] = [
	"last_seen",
	"sessions",
	"tool_calls",
	"cost",
	"tokens",
	"work",
];

function asSortBy(value: unknown): CodingUsersSortBy | undefined {
	if (typeof value !== "string") return undefined;
	return (VALID_SORT_BY as string[]).includes(value)
		? (value as CodingUsersSortBy)
		: undefined;
}

function asSortDir(value: unknown): "asc" | "desc" | undefined {
	if (value === "asc" || value === "desc") return value;
	return undefined;
}

export const dynamic = "force-dynamic";

function asString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function asDate(value: unknown): Date | null {
	if (!value) return null;
	const date = new Date(value as string | number | Date);
	return Number.isNaN(date.getTime()) ? null : date;
}

// Default analysis window matches the Sessions route — see B1
// rationale: never let a missing filter trigger an all-time scan.
const DEFAULT_WINDOW_HOURS = 24;
function defaultSince(): Date {
	return new Date(Date.now() - DEFAULT_WINDOW_HOURS * 60 * 60 * 1000);
}

export async function GET(request: Request) {
	let auth;
	try {
		auth = await requireCodingAgentAuth();
	} catch (err) {
		if (err instanceof CodingAgentUnauthorizedError) {
			return Response.json({ error: err.message }, { status: 401 });
		}
		throw err;
	}

	const url = new URL(request.url);
	const sp = url.searchParams;
	const limitRaw = sp.get("limit");
	const offsetRaw = sp.get("offset");
	const opts: ListCodingUsersOptions = {
		limit: limitRaw ? Number(limitRaw) : undefined,
		offset: offsetRaw ? Number(offsetRaw) : undefined,
		vendor: sp.get("vendor"),
		since: sp.get("since") ? new Date(sp.get("since") as string) : defaultSince(),
		until: sp.get("until") ? new Date(sp.get("until") as string) : null,
		sortBy: asSortBy(sp.get("sortBy")),
		sortDir: asSortDir(sp.get("sortDir")),
		withTotal: true,
	};

	try {
		const { rows, total } = await listCodingUsers(auth, opts);
		return Response.json({ data: rows, total });
	} catch (err) {
		console.error("coding_agent.users.list_failed", err);
		return Response.json({ error: "Internal error" }, { status: 500 });
	}
}

interface UsersListBody {
	timeLimit?: { start?: string | Date; end?: string | Date };
	selectedConfig?: Record<string, unknown>;
	sorting?: { type?: string; direction?: string };
	offset?: number;
	limit?: number;
	runFilters?: Record<string, unknown>;
}

export async function POST(request: Request) {
	let auth;
	try {
		auth = await requireCodingAgentAuth();
	} catch (err) {
		if (err instanceof CodingAgentUnauthorizedError) {
			return Response.json({ error: err.message }, { status: 401 });
		}
		throw err;
	}

	let body: UsersListBody = {};
	try {
		body = (await request.json()) as UsersListBody;
	} catch {
		// empty body is fine.
	}

	const runFilters = (body.runFilters || {}) as Record<string, unknown>;
	const limitRaw = Number(body.limit);
	const offsetRaw = Number(body.offset);
	const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 25;
	const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

	// Sorting is driven by the shared toolbar Sorting dropdown, which
	// writes to `body.sorting.{type,direction}`. This matches what the
	// Sessions route accepts.
	const opts: ListCodingUsersOptions = {
		limit,
		offset,
		withTotal: true,
		vendor: asString(runFilters.vendor),
		// Default 24h window — same rationale as Sessions route.
		since: asDate(body.timeLimit?.start) ?? defaultSince(),
		until: asDate(body.timeLimit?.end),
		sortBy: asSortBy(body.sorting?.type),
		sortDir: asSortDir(body.sorting?.direction),
	};

	try {
		const { rows, total } = await listCodingUsers(auth, opts);
		return Response.json({
			records: rows,
			total: total ?? rows.length,
		});
	} catch (err) {
		console.error("coding_agent.users.list_failed", err);
		return Response.json({ error: "Internal error" }, { status: 500 });
	}
}
