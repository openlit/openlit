import { resolveRequestAuth } from "@/helpers/server/auth";
import { getDBConfigByUser } from "@/lib/db-config";
import { getOtterUsage } from "@/lib/platform/chat/usage";
import asaw from "@/utils/asaw";

async function resolveDatabaseConfigId(authDatabaseConfigId?: string) {
	if (authDatabaseConfigId) return authDatabaseConfigId;
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	return (dbConfig as { id?: string } | null | undefined)?.id || "";
}

export async function GET(request: Request) {
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth) return Response.json("Unauthorized", { status: 401 });

	const databaseConfigId = await resolveDatabaseConfigId(auth.databaseConfigId);
	const searchParams = new URL(request.url).searchParams;
	const start = searchParams.get("start") || undefined;
	const end = searchParams.get("end") || undefined;
	const { data, err } = await getOtterUsage(databaseConfigId, { start, end });
	if (err) return Response.json(err, { status: 400 });

	return Response.json({ data });
}
