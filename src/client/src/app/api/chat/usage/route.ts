import { getDBConfigByUser } from "@/lib/db-config";
import { getOtterUsage } from "@/lib/platform/chat/usage";
import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";

async function getDatabaseConfigId() {
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	return (dbConfig as any)?.id || "";
}

export async function GET(request: Request) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const databaseConfigId = await getDatabaseConfigId();
	const searchParams = new URL(request.url).searchParams;
	const start = searchParams.get("start") || undefined;
	const end = searchParams.get("end") || undefined;
	const { data, err } = await getOtterUsage(databaseConfigId, { start, end });
	if (err) return Response.json(err, { status: 400 });

	return Response.json({ data });
}
