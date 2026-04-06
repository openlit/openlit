import { SUPPORTED_EVALUATION_OPERATIONS, TraceMapping } from "@/constants/traces";
import {
	TraceMappingKeyType,
	TransformedTraceRow,
	TraceRow,
	TraceHeirarchySpan,
} from "@/types/trace";
import { objectKeys } from "@/utils/object";
import { format } from "date-fns";
import { find, get, round } from "lodash";

/** Normalize raw record to TraceRow shape (handles snake_case from ClickHouse) */
export function ensureTraceRowShape(record: any): TraceRow {
	if (!record) return record;
	const r = record as Record<string, unknown>;
	return {
		...record,
		TraceId: r.TraceId ?? r.trace_id,
		SpanId: r.SpanId ?? r.span_id,
		ParentSpanId: r.ParentSpanId ?? r.parent_span_id ?? "",
		SpanName: r.SpanName ?? r.span_name ?? "",
		Timestamp: r.Timestamp ?? r.timestamp,
		Duration: r.Duration ?? r.duration ?? "",
		StatusCode: r.StatusCode ?? r.status_code ?? "",
		StatusMessage: r.StatusMessage ?? r.status_message ?? "",
		ServiceName: r.ServiceName ?? r.service_name ?? "",
		SpanKind: (r.SpanKind ?? r.span_kind) as any,
		TraceState: r.TraceState ?? r.trace_state ?? "",
		ResourceAttributes: r.ResourceAttributes ?? r.resource_attributes ?? {},
		SpanAttributes: r.SpanAttributes ?? r.span_attributes ?? {},
		ScopeName: r.ScopeName ?? r.scope_name ?? "",
		ScopeVersion: r.ScopeVersion ?? r.scope_version ?? "",
		Events: r.Events ?? r.events ?? [],
		Links: r.Links ?? r.links ?? [],
	} as TraceRow;
}

export const integerParser = (value: string, offset?: number) =>
	parseInt((value || "0") as string, 10) * (offset || 1);

export const floatParser = (value: string, offset?: number) =>
	parseFloat((value || "0") as string) * (offset || 1);

/** Extract readable text from gen_ai.input.messages / gen_ai.output.messages JSON */
function extractTextFromMessages(raw: unknown): string | undefined {
	if (raw == null) return undefined;
	let arr: Array<{ role?: string; parts?: Array<{ type?: string; content?: string }> }>;
	try {
		arr = typeof raw === "string" ? JSON.parse(raw) : raw;
	} catch {
		return undefined;
	}
	if (!Array.isArray(arr)) return undefined;
	const texts: string[] = [];
	for (const msg of arr) {
		const parts = msg?.parts;
		if (!Array.isArray(parts)) continue;
		for (const p of parts) {
			if (p?.type === "text" && typeof p.content === "string") {
				texts.push(p.content);
			}
		}
	}
	return texts.length > 0 ? texts.join("\n\n") : undefined;
}

export const getNormalizedTraceAttribute = (
	traceKey: TraceMappingKeyType,
	traceValue: unknown
) => {
	if (traceValue) {
		if (TraceMapping[traceKey].type === "integer") {
			return integerParser(traceValue as string, TraceMapping[traceKey].offset);
		} else if (TraceMapping[traceKey].type === "float") {
			return floatParser(
				(traceValue || "0") as string,
				TraceMapping[traceKey].offset
			).toFixed(10);
		} else if (TraceMapping[traceKey].type === "round") {
			return round(traceValue as number, TraceMapping[traceKey].offset).toFixed(
				10
			);
		} else if (TraceMapping[traceKey].type === "date") {
			const date = new Date(
				`${traceValue}${(traceValue as string).endsWith("Z") ? "" : "Z"}`
			);
			return format(date, "MMM do, y  HH:mm:ss a");
		} else {
			return traceValue;
		}
	} else {
		return TraceMapping[traceKey].defaultValue;
	}
};

export const normalizeTrace = (item: TraceRow): TransformedTraceRow => {
	const spanAttrs = item?.SpanAttributes ?? {};
	const resourceAttrs = (item as any)?.ResourceAttributes ?? {};
	return objectKeys(TraceMapping).reduce(
		(acc: TransformedTraceRow, traceKey: TraceMappingKeyType) => {
			let value: unknown;
			const mapping = TraceMapping[traceKey];
			if (mapping.isRoot) {
				value = get(item, mapping.path);
				// applicationName and environment live in ResourceAttributes, not at root
				if (value == null && traceKey === "applicationName") {
					value = resourceAttrs["service.name"];
				} else if (value == null && traceKey === "environment") {
					value = resourceAttrs["deployment.environment"];
				} else if (value == null && traceKey === "prompt") {
					value =
						spanAttrs["gen_ai.content.prompt"] ??
						spanAttrs["gen_ai.request.input"] ??
						extractTextFromMessages(spanAttrs["gen_ai.input.messages"]);
				} else if (value == null && traceKey === "response") {
					value =
						spanAttrs["gen_ai.content.completion"] ??
						spanAttrs["gen_ai.response.output"] ??
						extractTextFromMessages(spanAttrs["gen_ai.output.messages"]);
				} else if (value == null && traceKey === "revisedPrompt") {
					value = spanAttrs["gen_ai.content.revised_prompt"];
				}
			} else {
				value = get(spanAttrs, getTraceMappingKeyFullPath(traceKey));
				// Backward compatibility: new OTel convention for token usage
				if (value == null && traceKey === "totalTokens") {
					value = spanAttrs["gen_ai.client.token.usage"];
				} else if (value == null && traceKey === "promptTokens") {
					value = spanAttrs["gen_ai.client.token.usage.input"];
				} else if (value == null && traceKey === "completionTokens") {
					value = spanAttrs["gen_ai.client.token.usage.output"];
				}
			}

			acc[traceKey] = getNormalizedTraceAttribute(traceKey, value);
			return acc;
		},
		{} as TransformedTraceRow
	);
};

export const getTraceMappingKeyFullPath = (
	key: TraceMappingKeyType,
	shouldReturnArray: boolean = false
) => {
	if (!TraceMapping[key].prefix) {
		if (!shouldReturnArray) {
			if (typeof TraceMapping[key].path !== "string") {
				return (TraceMapping[key].path as string[]).join(".");
			}
		}
		return TraceMapping[key].path;
	}
	if (shouldReturnArray) {
		let returnArr: string[] = [];
		if (typeof TraceMapping[key].prefix === "string") {
			returnArr = returnArr.concat([TraceMapping[key].prefix as string]);
		} else {
			returnArr = returnArr.concat(TraceMapping[key].prefix as string[]);
		}

		if (typeof TraceMapping[key].path === "string") {
			returnArr = returnArr.concat([TraceMapping[key].path as string]);
		} else {
			returnArr = returnArr.concat(TraceMapping[key].path as string[]);
		}
		return returnArr;
	}

	let returnString = "";
	if (typeof TraceMapping[key].prefix === "string") {
		returnString = TraceMapping[key].prefix as string;
	} else {
		returnString = (TraceMapping[key].prefix as string[]).join(".");
	}

	if (typeof TraceMapping[key].path === "string") {
		returnString = [returnString, TraceMapping[key].path as string].join(".");
	} else {
		returnString = [
			returnString,
			(TraceMapping[key].path as string[]).join("."),
		].join(".");
	}

	return returnString;
};

export const CODE_ITEM_DISPLAY_KEYS: TraceMappingKeyType[] = [
	"prompt",
	"revisedPrompt",
	"response",
	/* Vector */
	"statement",
	"whereDocument",
	"filter",
	/* Framework */
	"retrievalSource",
	/* Exception */
	"statusMessage",
	/* Long-text span attrs */
	"systemInstructions",
	"contentReasoning",
	"toolArgs",
	"dbQueryText"
];

/**
 * Span attribute keys to surface as individual InfoPills in the detail panel.
 * These are non-root TraceMapping entries (i.e. sourced from SpanAttributes).
 * Ordered so the most important attributes appear first.
 */
export const SPAN_ATTR_INFO_PILL_KEYS: TraceMappingKeyType[] = [
	// Core LLM identifiers
	"model", "provider", "type", "endpoint", "responseModel", "outputType",
	// Request parameters
	"temperature", "requestTopP", "requestTopK",
	"requestFrequencyPenalty", "requestPresencePenalty",
	"maxTokens", "randomSeed", "requestChoiceCount",
	"requestIsStream", "requestUser", "requestToolChoice",
	// Response
	"responseId", "finishReason",
	// Token usage
	"promptTokens", "completionTokens", "totalTokens", "cost",
	"cacheReadTokens", "cacheCreationTokens", "reasoningTokens",
	// Streaming latency
	"ttft", "tbt",
	// Tool calls
	"toolName", "toolCallId",
	// Reasoning
	"reasoningEffort",
	// OpenAI-specific
	"openaiApiType", "openaiRequestServiceTier", "openaiResponseServiceTier",
	"openaiSystemFingerprint",
	// Audio
	"audioVoice", "audioFormat", "audioSpeed",
	// Image
	"imageSize", "imageQuality", "imageStyle",
	// Embedding
	"embeddingFormat", "embeddingDimension",
	// Fine-tuning
	"trainingFile", "validationFile", "fineTuneBatchSize",
	"learningRateMultiplier", "fineTuneNEpochs", "fineTuneModelSuffix", "finetuneJobStatus",
	// Vector DB
	"operation", "system", "dbSystemName", "dbOperationName",
	"collectionName", "nResults", "documentsCount", "idsCount", "vectorCount",
	// Framework
	"owner", "repo",
];

/**
 * Set of all SpanAttribute dot-path keys that are already covered by TraceMapping.
 * Any key in SpanAttributes that is NOT in this set is a custom user-defined attribute.
 */
export const KNOWN_SPAN_ATTR_KEYS = new Set<string>(
	objectKeys(TraceMapping)
		.filter((key) => !TraceMapping[key].isRoot)
		.map((key) => {
			const path = getTraceMappingKeyFullPath(key);
			return Array.isArray(path) ? path.join(".") : (path as string);
		})
);

/**
 * Get formatted duration string for a hierarchy span (e.g. "1.20s").
 */
export function getSpanDurationDisplay(span: TraceHeirarchySpan): string {
	const durationStr = parseFloat(
		getNormalizedTraceAttribute("requestDuration", span.Duration) as string
	).toFixed(2);
	return `${durationStr}${TraceMapping.requestDuration.valueSuffix}`;
}

/**
 * Get formatted cost string for a hierarchy span, or null if no cost.
 */
export function getSpanCostFormatted(
	span: TraceHeirarchySpan,
	precision = 6
): string | null {
	if (span.Cost == null || span.Cost <= 0) return null;
	return `$${Number(span.Cost).toFixed(precision)}`;
}

/**
 * Get tooltip text for a hierarchy span (name, duration, cost).
 */
export function getSpanTooltipText(span: TraceHeirarchySpan): string {
	const durationDisplay = getSpanDurationDisplay(span);
	const costStr = getSpanCostFormatted(span, 10);
	return costStr
		? `${span.SpanName}\nDuration: ${durationDisplay}\nCost: ${costStr}`
		: `${span.SpanName}\nDuration: ${durationDisplay}`;
}

export function findSpanInHierarchyLodash(
	hierarchy: TraceHeirarchySpan,
	targetSpanId: string
): TraceHeirarchySpan | undefined {
	// Check current span
	if (hierarchy.SpanId === targetSpanId) {
		return hierarchy;
	}

	// Search in children if they exist
	if (hierarchy.children?.length) {
		return find(hierarchy.children, (child) => {
			return findSpanInHierarchyLodash(child, targetSpanId);
		}) as TraceHeirarchySpan | undefined;
	}

	return undefined;
}

export function getExtraTabsContentTypes(trace: TransformedTraceRow) {
	const defaultTabs = [];

	if (SUPPORTED_EVALUATION_OPERATIONS.includes(trace.type)) {
		defaultTabs.push("Evaluation");
	}

	return defaultTabs;
}
