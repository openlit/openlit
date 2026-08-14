import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getEvaluationConfig } from "@/lib/platform/evaluation/config";
import { normalizeThresholdScore } from "@/lib/platform/evaluation/threshold";
import {
	normalizeTypeConfig,
	persistEvaluationTypes,
} from "@/lib/platform/evaluation/type-config";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";
import getMessage from "@/constants/messages";

export type {
	RuleWithPriority,
	EvaluationTypeConfig,
} from "@/lib/platform/evaluation/type-config";

async function GETHandler(_: NextRequest) {
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		return Response.json(
			{ err: "Evaluation config not found", data: [] },
			{ status: 200 }
		);
	}

	const types = (config as any).evaluationTypes ?? [];
	return Response.json({ data: types });
}

async function POSTHandler(request: NextRequest) {
	const startTimestamp = Date.now();
	let body: any;
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: "Invalid JSON body" }, { status: 400 });
	}
	const types = body.types as any[] | undefined;
	if (!Array.isArray(types)) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json({ err: "Invalid types array" }, { status: 400 });
	}

	const thresholdScores: Array<number | undefined> = [];
	for (const t of types) {
		const normalized = normalizeThresholdScore(t?.thresholdScore);
		if (Number.isNaN(normalized)) {
			PostHogServer.fireEvent({
				event: SERVER_EVENTS.EVALUATION_TYPE_CREATE_FAILURE,
				startTimestamp,
			});
			return Response.json(
				{ err: getMessage().EVALUATION_THRESHOLD_SCORE_INVALID },
				{ status: 400 }
			);
		}
		thresholdScores.push(normalized);
	}

	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json({ err: "Evaluation config not found" }, { status: 400 });
	}

	const normalizedTypes = types.map((t, i) =>
		normalizeTypeConfig(t, thresholdScores[i])
	);

	await persistEvaluationTypes(config.id, (config as any).meta, normalizedTypes);

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_TYPE_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json({ data: normalizedTypes });
}

export const GET = withCurrentOrganisationPermission("evaluation:read", GETHandler);
export const POST = withAudit(withCurrentOrganisationPermission("evaluation:configure", POSTHandler));
