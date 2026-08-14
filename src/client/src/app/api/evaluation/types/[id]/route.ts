import { withAudit } from "@/lib/audit/route";
import { withCurrentOrganisationPermission } from "@/lib/rbac/current";
import { getEvaluationConfig } from "@/lib/platform/evaluation/config";
import { normalizeThresholdScore } from "@/lib/platform/evaluation/threshold";
import {
	normalizeRules,
	mergeTypeIntoList,
	persistEvaluationTypes,
	EvaluationTypeConfig,
} from "@/lib/platform/evaluation/type-config";
import { SERVER_EVENTS } from "@/constants/events";
import PostHogServer from "@/lib/posthog";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";
import { jsonParse } from "@/utils/json";
import getMessage from "@/constants/messages";

export type {
	RuleWithPriority,
	EvaluationTypeConfig,
} from "@/lib/platform/evaluation/type-config";

async function GETHandler(
	_: NextRequest,
	{ params }: { params: { id: string } }
) {
	const typeId = params.id;
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		return Response.json(
			{ err: "Evaluation config not found" },
			{ status: 404 }
		);
	}
	const types = (config as any).evaluationTypes ?? [];
	const typeConfig = types.find((t: any) => t.id === typeId);
	if (!typeConfig) {
		return Response.json(
			{ err: "Evaluation type not found" },
			{ status: 404 }
		);
	}
	return Response.json({ data: typeConfig });
}

async function PATCHHandler(
	request: NextRequest,
	{ params }: { params: { id: string } }
) {
	const startTimestamp = Date.now();
	const typeId = params.id;
	let body: any;
	try {
		body = await request.json();
	} catch {
		return Response.json({ err: "Invalid JSON body" }, { status: 400 });
	}

	const thresholdScore =
		body.thresholdScore !== undefined
			? normalizeThresholdScore(body.thresholdScore)
			: undefined;
	if (Number.isNaN(thresholdScore)) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_UPDATE_FAILURE,
			startTimestamp,
		});
		return Response.json(
			{ err: getMessage().EVALUATION_THRESHOLD_SCORE_INVALID },
			{ status: 400 }
		);
	}

	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_UPDATE_FAILURE,
			startTimestamp,
		});
		return Response.json(
			{ err: "Evaluation config not found" },
			{ status: 400 }
		);
	}
	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	const types: EvaluationTypeConfig[] =
		(meta.evaluationTypes as EvaluationTypeConfig[]) || [];
	const idx = types.findIndex((t: any) => t.id === typeId);
	const existing = idx >= 0 ? types[idx] : { id: typeId, enabled: false, rules: [] };
	const updated: EvaluationTypeConfig = {
		id: typeId,
		enabled: body.enabled ?? existing.enabled,
		rules: body.rules !== undefined ? normalizeRules(body.rules) : existing.rules || [],
		prompt: body.prompt !== undefined ? body.prompt : existing.prompt,
		thresholdScore:
			body.thresholdScore !== undefined
				? thresholdScore
				: (existing as any).thresholdScore,
	};
	// Preserve or update custom type metadata
	if (body.isCustom || (existing as any).isCustom) {
		updated.isCustom = true;
		updated.label = body.label ?? (existing as any).label ?? typeId;
		updated.description = body.description ?? (existing as any).description ?? "";
	}

	await persistEvaluationTypes(
		config.id,
		(config as any).meta,
		mergeTypeIntoList(types, updated)
	);

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_TYPE_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json({ data: updated });
}

async function DELETEHandler(
	_: NextRequest,
	{ params }: { params: { id: string } }
) {
	const startTimestamp = Date.now();
	const typeId = params.id;
	const [err, config] = await asaw(getEvaluationConfig(undefined, true, false));
	if (err || !config?.id) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_DELETE_FAILURE,
			startTimestamp,
		});
		return Response.json(
			{ err: "Evaluation config not found" },
			{ status: 400 }
		);
	}
	const meta = jsonParse((config as any).meta || "{}") as Record<string, any>;
	const types: EvaluationTypeConfig[] =
		(meta.evaluationTypes as EvaluationTypeConfig[]) || [];

	const typeToDelete = types.find((t) => t.id === typeId);
	if (!typeToDelete?.isCustom) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.EVALUATION_TYPE_DELETE_FAILURE,
			startTimestamp,
		});
		return Response.json(
			{ err: "Only custom evaluation types can be deleted" },
			{ status: 400 }
		);
	}

	await persistEvaluationTypes(
		config.id,
		(config as any).meta,
		types.filter((t) => t.id !== typeId)
	);

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.EVALUATION_TYPE_DELETE_SUCCESS,
		startTimestamp,
	});
	return Response.json({ data: { deleted: typeId } });
}

export const GET = withCurrentOrganisationPermission("evaluation:read", GETHandler);
export const PATCH = withAudit(withCurrentOrganisationPermission("evaluation:configure", PATCHHandler));
export const DELETE = withAudit(withCurrentOrganisationPermission("evaluation:configure", DELETEHandler));
