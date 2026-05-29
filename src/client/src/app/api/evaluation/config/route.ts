import {
	getEvaluationConfig,
	setEvaluationConfig,
} from "@/lib/platform/evaluation/config";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { EvaluationConfigInput } from "@/types/evaluation";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";

export async function GET(_: NextRequest) {
	const startTimestamp = Date.now();
	const res: any = await getEvaluationConfig(undefined, true, false);
	PostHogServer.fireEvent({
		event: res.err ? SERVER_EVENTS.EVALUATION_CONFIG_GET_FAILURE : SERVER_EVENTS.EVALUATION_CONFIG_GET_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

export async function POST(request: NextRequest) {
	const startTimestamp = Date.now();
	const formData = await request.json();
	const evaluationConfig: EvaluationConfigInput = {
		id: formData.id,
		provider: formData.provider,
		model: formData.model,
		vaultId: formData.vaultId,
		auto: formData.auto,
		recurringTime: formData.recurringTime || "",
		meta: formData.meta || "{}",
	};

	const [err, data] = await asaw(
		setEvaluationConfig(evaluationConfig, request.nextUrl.origin)
	);

	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_CONFIG_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, {
			status: 400,
		});
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_CONFIG_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(data);
}
