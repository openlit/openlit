import { getDBConfigByUser } from "@/lib/db-config";
import {
	getTraceImprovement,
	streamTraceImprovementAnalysis,
} from "@/lib/platform/chat/improvement";
import { getCurrentUser } from "@/lib/session";
import asaw from "@/utils/asaw";

async function getDatabaseConfigId() {
	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	return (dbConfig as any)?.id || "";
}

export async function GET(_: Request, context: any) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const { spanId } = context.params || {};
	if (!spanId) {
		return Response.json("No span id provided", { status: 400 });
	}

	const databaseConfigId = await getDatabaseConfigId();
	const { data, err } = await getTraceImprovement(spanId, databaseConfigId);
	if (err) return Response.json(err, { status: 400 });

	return Response.json({ data: data || null });
}

export async function POST(_: Request, context: any) {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const { spanId } = context.params || {};
	if (!spanId) {
		return Response.json("No span id provided", { status: 400 });
	}

	const databaseConfigId = await getDatabaseConfigId();
	const { response, err } = await streamTraceImprovementAnalysis(
		spanId,
		databaseConfigId
	);
	if (err) return Response.json(err, { status: 400 });
	if (!response) {
		return Response.json("Failed to run AI improvement analysis", {
			status: 400,
		});
	}

	return response;
}
