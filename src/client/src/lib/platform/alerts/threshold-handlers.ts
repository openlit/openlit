import getMessage from "@/constants/messages";
import { getRequestEnvironment } from "@/constants/openlit-context";
import { getCurrentUser } from "@/lib/session";
import {
	RealtimeRuleError,
	parseRealtimeRuleInput,
	resolveRealtimeRuleScope,
} from "@/lib/platform/realtime/rule-store";
import { getThresholdAlertTemplates } from "@/lib/platform/realtime/templates";
import {
	createThresholdAlert,
	deleteThresholdAlert,
	getThresholdAlert,
	getThresholdAlertOverview,
	listThresholdAlertFindings,
	listThresholdAlertSignals,
	listThresholdAlerts,
	setThresholdAlertEnabled,
	updateThresholdAlert,
} from "./threshold";

// Route handlers for threshold alerts. CE routes export them directly; the
// enterprise overlay calls them from its own alert routes and adds delivery.

type IdContext = { params: { id: string } | Promise<{ id: string }> };

export async function alertIdFromContext(context: IdContext): Promise<string> {
	const params = await context?.params;
	return String(params?.id || "");
}

export function thresholdAlertErrorResponse(error: unknown) {
	if (error instanceof RealtimeRuleError) {
		return Response.json({ error: error.message }, { status: error.status });
	}
	console.error("[alerts] threshold alert request failed", error);
	return Response.json({ error: getMessage().ALERT_THRESHOLD_FAILED }, { status: 500 });
}

export async function readThresholdAlertBody(request: Request): Promise<unknown | Response> {
	try {
		return await request.json();
	} catch {
		return Response.json({ error: getMessage().ALERT_THRESHOLD_INVALID_JSON }, { status: 400 });
	}
}

async function scopeFor(request: Request) {
	return resolveRealtimeRuleScope(getRequestEnvironment(request));
}

export async function listThresholdAlertsHandler(request: Request) {
	try {
		return Response.json({ data: await listThresholdAlerts(await scopeFor(request)) });
	} catch (error) {
		return thresholdAlertErrorResponse(error);
	}
}

export async function createThresholdAlertHandler(request: Request) {
	const body = await readThresholdAlertBody(request);
	if (body instanceof Response) return body;
	try {
		const input = parseRealtimeRuleInput(body);
		const alert = await createThresholdAlert(await scopeFor(request), input);
		return Response.json({ data: alert }, { status: 201 });
	} catch (error) {
		return thresholdAlertErrorResponse(error);
	}
}

export async function getThresholdAlertHandler(request: Request, context: IdContext) {
	try {
		return Response.json({ data: await getThresholdAlert(await scopeFor(request), await alertIdFromContext(context)) });
	} catch (error) {
		return thresholdAlertErrorResponse(error);
	}
}

/** `{ enabled }` alone toggles the alert; any other body replaces its definition. */
export async function updateThresholdAlertHandler(request: Request, context: IdContext) {
	const body = await readThresholdAlertBody(request);
	if (body instanceof Response) return body;
	try {
		const scope = await scopeFor(request);
		const id = await alertIdFromContext(context);
		const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
		if (keys.length === 1 && keys[0] === "enabled") {
			const enabled = (body as { enabled: unknown }).enabled;
			if (typeof enabled !== "boolean") {
				return Response.json({ error: getMessage().REALTIME_RULE_INVALID }, { status: 400 });
			}
			return Response.json({ data: await setThresholdAlertEnabled(scope, id, enabled) });
		}
		return Response.json({ data: await updateThresholdAlert(scope, id, parseRealtimeRuleInput(body)) });
	} catch (error) {
		return thresholdAlertErrorResponse(error);
	}
}

export async function deleteThresholdAlertHandler(request: Request, context: IdContext) {
	try {
		return Response.json({ data: await deleteThresholdAlert(await scopeFor(request), await alertIdFromContext(context)) });
	} catch (error) {
		return thresholdAlertErrorResponse(error);
	}
}

export async function thresholdAlertFindingsHandler(request: Request, context: IdContext) {
	try {
		const params = new URL(request.url).searchParams;
		const findings = await listThresholdAlertFindings(await scopeFor(request), await alertIdFromContext(context), {
			state: params.get("state"),
			limit: Number(params.get("limit")) || undefined,
		});
		return Response.json({ data: findings });
	} catch (error) {
		return thresholdAlertErrorResponse(error);
	}
}

export async function thresholdAlertSignalsHandler(request: Request, context: IdContext) {
	try {
		const limit = Number(new URL(request.url).searchParams.get("limit")) || 100;
		return Response.json(
			await listThresholdAlertSignals(await scopeFor(request), await alertIdFromContext(context), limit)
		);
	} catch (error) {
		return thresholdAlertErrorResponse(error);
	}
}

export async function thresholdAlertOverviewHandler(request: Request) {
	try {
		return Response.json({ data: await getThresholdAlertOverview(await scopeFor(request)) });
	} catch (error) {
		return thresholdAlertErrorResponse(error);
	}
}

export async function thresholdAlertTemplatesHandler() {
	const user = await getCurrentUser();
	if (!user) return Response.json({ error: getMessage().UNAUTHORIZED_USER }, { status: 401 });
	return Response.json({ data: getThresholdAlertTemplates() });
}
