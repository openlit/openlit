import { getDBConfigByUser } from "@/lib/db-config";
import { getComparisonBySpanIds } from "@/lib/platform/chat/improvement";
import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";

async function getDatabaseConfigId() {
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	return (dbConfig as any)?.id || "";
}

export async function POST(req: Request) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const body = await req.json().catch(() => ({}));
	const spanIds: string[] = Array.isArray(body?.spanIds) ? body.spanIds : [];

	if (spanIds.length < 2) {
		return Response.json("At least two span IDs are required", { status: 400 });
	}

	if (spanIds.length > 6) {
		return Response.json("Maximum 6 traces can be compared at once", { status: 400 });
	}

	const databaseConfigId = await getDatabaseConfigId();
	const { data, err } = await getComparisonBySpanIds(spanIds, databaseConfigId);
	if (err) return Response.json(err, { status: 400 });

	return Response.json({ data: data || [] });
}
