import { NextRequest, NextResponse } from "next/server";
import { SERVER_EVENTS } from "@/constants/events";
import { getCurrentUser } from "@/lib/session";
import { getRuleById } from "@/lib/platform/rule-engine";
import { dataCollector, OTEL_TRACES_TABLE_NAME } from "@/lib/platform/common";
import PostHogServer from "@/lib/posthog";

type Condition = {
	field: string;
	operator: string;
	value: string;
	data_type: string;
};

type ConditionGroup = {
	condition_operator: "AND" | "OR";
	conditions: Condition[];
};

// Map condition field name → alias column in the SELECT query
function getTraceFieldValue(trace: Record<string, any>, field: string): string {
	const map: Record<string, string> = {
		ServiceName: "ServiceName",
		SpanName: "SpanName",
		SpanKind: "SpanKind",
		Duration: "Duration",
		StatusCode: "StatusCode",
		"deployment.environment": "env",
		"service.name": "service_name",
		"gen_ai.system": "gen_ai_system",
		"gen_ai.request.model": "model",
		"gen_ai.usage.input_tokens": "input_tokens",
		"gen_ai.usage.output_tokens": "output_tokens",
		"gen_ai.usage.total_cost": "total_cost",
		"gen_ai.request.temperature": "temperature",
	};
	const col = map[field];
	return col ? String(trace[col] ?? "") : "";
}

function evalCondition(cond: Condition, traceValue: string): boolean {
	const { operator, value, data_type } = cond;

	if (data_type === "number") {
		const tv = parseFloat(traceValue);
		const cv = parseFloat(value);
		if (isNaN(tv)) return false;
		switch (operator) {
			case "equals": return tv === cv;
			case "not_equals": return tv !== cv;
			case "gt": return tv > cv;
			case "gte": return tv >= cv;
			case "lt": return tv < cv;
			case "lte": return tv <= cv;
			case "between": {
				const [lo, hi] = value.split(",").map(parseFloat);
				return tv >= lo && tv <= hi;
			}
		}
		return false;
	}

	switch (operator) {
		case "equals": return traceValue === value;
		case "not_equals": return traceValue !== value;
		case "contains": return traceValue.includes(value);
		case "not_contains": return !traceValue.includes(value);
		case "starts_with": return traceValue.startsWith(value);
		case "ends_with": return traceValue.endsWith(value);
		case "regex": {
			try { return new RegExp(value).test(traceValue); } catch { return false; }
		}
		case "in": return value.split(",").map((v) => v.trim()).includes(traceValue);
		case "not_in": return !value.split(",").map((v) => v.trim()).includes(traceValue);
	}
	return false;
}

function evaluateRule(
	groups: ConditionGroup[],
	groupOperator: "AND" | "OR",
	trace: Record<string, any>
): boolean {
	if (groups.length === 0) return false;
	const groupResults = groups.map((group) => {
		if (group.conditions.length === 0) return false;
		const condResults = group.conditions.map((cond) =>
			evalCondition(cond, getTraceFieldValue(trace, cond.field))
		);
		return group.condition_operator === "AND"
			? condResults.every(Boolean)
			: condResults.some(Boolean);
	});
	return groupOperator === "AND"
		? groupResults.every(Boolean)
		: groupResults.some(Boolean);
}

export async function POST(
	_req: NextRequest,
	{ params }: { params: { id: string } }
) {
	const startTimestamp = Date.now();
	try {
		const user = await getCurrentUser();
		if (!user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const ruleId = params.id;

		// getRuleById returns { data: ruleObject } (not an array)
		const ruleResult = await getRuleById(ruleId);
		if ((ruleResult as any).err || !ruleResult.data) {
			return NextResponse.json({ error: "Rule not found" }, { status: 404 });
		}
		const rule = ruleResult.data as any;
		if (!rule?.id) {
			return NextResponse.json({ error: "Rule not found" }, { status: 404 });
		}

		// Fetch recent traces to evaluate against the rule conditions
		const query = `
			SELECT
				TraceId,
				SpanId,
				ServiceName,
				SpanName,
				SpanKind,
				toString(Duration) AS Duration,
				StatusCode,
				SpanAttributes['deployment.environment']   AS env,
				ResourceAttributes['service.name']         AS service_name,
				SpanAttributes['gen_ai.system']            AS gen_ai_system,
				SpanAttributes['gen_ai.request.model']     AS model,
				SpanAttributes['gen_ai.usage.input_tokens']  AS input_tokens,
				SpanAttributes['gen_ai.usage.output_tokens'] AS output_tokens,
				SpanAttributes['gen_ai.usage.total_cost']    AS total_cost,
				SpanAttributes['gen_ai.request.temperature'] AS temperature
			FROM ${OTEL_TRACES_TABLE_NAME}
			ORDER BY Timestamp DESC
			LIMIT 100;
		`;

		const { data: tracesData, err: tracesErr } = await dataCollector({ query }, "query");
		if (tracesErr) {
			return NextResponse.json({ error: "Failed to fetch traces" }, { status: 500 });
		}

		const traces = (tracesData as any[]) || [];

		// Build condition groups from the saved rule data
		const groups: ConditionGroup[] = (rule.condition_groups || []).map((g: any) => ({
			condition_operator: g.condition_operator || "AND",
			conditions: (g.conditions || []).map((c: any) => ({
				field: c.field,
				operator: c.operator,
				value: c.value,
				data_type: c.data_type || "string",
			})),
		}));

		// Return only the top 5 matched traces
		const results = traces
			.filter((trace: any) =>
				evaluateRule(groups, rule.group_operator || "AND", trace)
			)
			.slice(0, 5)
			.map((trace: any) => ({
				TraceId: trace.TraceId,
				SpanId: trace.SpanId,
				ServiceName: trace.ServiceName,
				SpanName: trace.SpanName,
				matched: true,
			}));

		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_PREVIEW_SUCCESS,
			startTimestamp,
		});
		return NextResponse.json({ results });
	} catch (err: any) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.RULE_PREVIEW_FAILURE,
			startTimestamp,
		});
		const message = err?.message || "Internal server error";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
