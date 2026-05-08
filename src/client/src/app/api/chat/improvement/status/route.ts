import { getDBConfigByUser } from "@/lib/db-config";
import { getAnalysisStatusBySpanIds } from "@/lib/platform/chat/improvement";
import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";

async function getDatabaseConfigId() {
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	return (dbConfig as any)?.id || "";
}

export async function GET(req: Request) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const url = new URL(req.url);
	const spanIdsParam = url.searchParams.get("spanIds") || "";
	const spanIds = spanIdsParam
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	if (!spanIds.length) {
		return Response.json({ data: {} });
	}

	const databaseConfigId = await getDatabaseConfigId();
	const { data, err } = await getAnalysisStatusBySpanIds(spanIds, databaseConfigId);
	if (err) return Response.json(err, { status: 400 });

	return Response.json({ data: data || {} });
}
