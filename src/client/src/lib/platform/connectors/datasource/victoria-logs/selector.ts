import type { OpenLITQuery } from "../types";

const LABELS: Record<string, string> = {
	"service.name": "service_name",
	serviceName: "service_name",
	"trace.id": "trace_id",
	traceId: "trace_id",
	"span.id": "span_id",
	spanId: "span_id",
	severity: "level",
	severityText: "level",
	job: "job",
	instance: "instance",
};

function escapeString(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/[\r\n\0]/g, " ")}"`;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldName(key: string): string {
	const mapped = LABELS[key] || key;
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(mapped)
		? mapped
		: mapped.replace(/[^A-Za-z0-9_]/g, "_");
}

function filterValues(value: unknown): string[] {
	const raw = Array.isArray(value) ? value : [value];
	return raw
		.filter((item) => item !== undefined && item !== null && String(item) !== "")
		.map(String);
}

function fieldFilter(
	name: string,
	values: string[],
	op: string | undefined
): string {
	if (values.length === 0) return "";
	if (op === "contains") {
		return `${name}:~${escapeString(`.*${escapeRegex(values[0])}.*`)}`;
	}
	const negative = op === "neq" || op === "notIn";
	if (values.length === 1 && op !== "in" && op !== "notIn") {
		const clause = `${name}:=${escapeString(values[0])}`;
		return negative ? `!${clause}` : clause;
	}
	const clause = `${name}:~${escapeString(values.map(escapeRegex).join("|"))}`;
	return negative ? `!${clause}` : clause;
}

/** Compile the shared AI selector into VictoriaLogs LogsQL. */
export function victoriaLogsSelector(query: OpenLITQuery, fallback: string): string {
	const parts: string[] = [];
	for (const filter of query.filters || []) {
		const values = filterValues(filter.value);
		if (
			filter.target === "spanName" ||
			(filter.target === "attribute" &&
				(filter.key === "body" || filter.key === "message"))
		) {
			for (const value of values) {
				if (filter.op === "neq" || filter.op === "notIn") {
					parts.push(`!_msg:${escapeString(value)}`);
					continue;
				}
				if (filter.op === "contains") {
					parts.push(`_msg:~${escapeString(`.*${escapeRegex(value)}.*`)}`);
					continue;
				}
				parts.push(escapeString(value));
			}
			continue;
		}
		if (filter.target !== "attribute" || !filter.key || values.length === 0) {
			continue;
		}
		const clause = fieldFilter(fieldName(filter.key), values, filter.op);
		if (clause) parts.push(clause);
	}
	return parts.length ? parts.join(" ") : fallback;
}

export function victoriaLogsFieldName(key: string): string {
	return fieldName(key);
}
