import { NextRequest, NextResponse } from "next/server";
import { SERVER_EVENTS } from "@/constants/events";
import { getCurrentUser } from "@/lib/session";
import { getRuleById } from "@/lib/platform/rule-engine";
import { listRecentRuleTraces, getRuleTraceFieldValue } from "@/lib/platform/rule-engine/telemetry";
import PostHogServer from "@/lib/posthog";
import { getRequestEnvironment } from "@/constants/openlit-context";

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
			 evalCondition(cond, getRuleTraceFieldValue(trace, cond.field))
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

		// Fetch through the active traces connector; this is intentionally not a
		// direct ClickHouse query because rules must preview external telemetry.
		const traces = await listRecentRuleTraces(100, getRequestEnvironment(_req));

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
