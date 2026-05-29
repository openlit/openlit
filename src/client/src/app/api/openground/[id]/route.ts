import { SERVER_EVENTS } from "@/constants/events";
import { getOpengroundEvaluationById } from "@/lib/platform/openground-clickhouse";
import { getCurrentUser } from "@/lib/session";
import { getDBConfigByUser } from "@/lib/db-config";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";
import getMessage from "@/constants/messages";

export async function GET(_: Request, { params }: { params: { id: string } }) {
	const startTimestamp = Date.now();
	const user = await getCurrentUser();
	if (!user) {
		return Response.json({ error: getMessage().UNAUTHORIZED_USER }, { status: 401 });
	}

	const [, dbConfig] = await asaw(getDBConfigByUser(true));
	if (!dbConfig) {
		return Response.json(
			{ error: getMessage().DATABASE_CONFIG_NOT_FOUND },
			{ status: 404 }
		);
	}

	const { data, err } = await getOpengroundEvaluationById(params.id, dbConfig.id);

	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.OPENGROUND_GET_FAILURE,
			startTimestamp,
		});
		return Response.json({ error: err }, { status: 404 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.OPENGROUND_GET_SUCCESS,
		startTimestamp,
	});
	return Response.json(data);
}
