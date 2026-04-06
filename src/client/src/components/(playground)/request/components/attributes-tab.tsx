"use client";

import { TraceMapping } from "@/constants/traces";
import {
	CODE_ITEM_DISPLAY_KEYS,
	KNOWN_SPAN_ATTR_KEYS,
	getTraceMappingKeyFullPath,
} from "@/helpers/client/trace";
import { TraceMappingKeyType, TransformedTraceRow } from "@/types/trace";
import { isNil } from "lodash";

type AttrGroup = { label: string; keys: TraceMappingKeyType[] };

const ATTR_GROUPS: AttrGroup[] = [
	{
		label: "Model & Request",
		keys: [
			"model", "provider", "type", "endpoint", "responseModel", "outputType",
			"temperature", "requestTopP", "requestTopK",
			"requestFrequencyPenalty", "requestPresencePenalty",
			"maxTokens", "randomSeed", "requestChoiceCount",
			"requestIsStream", "requestUser", "requestToolChoice", "reasoningEffort",
		],
	},
	{
		label: "Response",
		keys: ["responseId", "finishReason"],
	},
	{
		label: "Usage",
		keys: [
			"promptTokens", "completionTokens", "totalTokens", "cost",
			"cacheReadTokens", "cacheCreationTokens", "reasoningTokens",
		],
	},
	{
		label: "Latency",
		keys: ["ttft", "tbt"],
	},
	{
		label: "Tools",
		keys: ["toolName", "toolCallId"],
	},
	{
		label: "OpenAI",
		keys: [
			"openaiApiType", "openaiRequestServiceTier",
			"openaiResponseServiceTier", "openaiSystemFingerprint",
		],
	},
	{
		label: "Media",
		keys: ["audioVoice", "audioFormat", "audioSpeed", "imageSize", "imageQuality", "imageStyle"],
	},
	{
		label: "Embeddings",
		keys: ["embeddingFormat", "embeddingDimension"],
	},
	{
		label: "Fine-tuning",
		keys: [
			"trainingFile", "validationFile", "fineTuneBatchSize",
			"learningRateMultiplier", "fineTuneNEpochs", "fineTuneModelSuffix", "finetuneJobStatus",
		],
	},
	{
		label: "Database",
		keys: [
			"operation", "system", "dbSystemName", "dbOperationName",
			"collectionName", "nResults", "documentsCount", "idsCount", "vectorCount",
		],
	},
	{
		label: "Framework",
		keys: ["owner", "repo"],
	},
];

const CODE_ITEM_KEY_SET = new Set<string>(CODE_ITEM_DISPLAY_KEYS);

export function GroupHeader({ label }: { label: string }) {
	return (
		<div className="sticky top-0 px-4 py-1.5 bg-stone-100 dark:bg-stone-800/80 border-y border-stone-200 dark:border-stone-700 first:border-t-0">
			<span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
				{label}
			</span>
		</div>
	);
}

/** Safely convert any value to a displayable string */
function safeStringify(val: unknown): string {
	if (val === null || val === undefined) return "";
	if (typeof val === "string") return val;
	if (typeof val === "number" || typeof val === "boolean") return String(val);
	try {
		return JSON.stringify(val, null, 2);
	} catch {
		return "[Complex Object]";
	}
}

export function AttrRow({ label, value, mono = false, className = "" }: { label: string; value: unknown; mono?: boolean; className?: string }) {
	const displayValue = safeStringify(value);
	return (
		<div className={`flex items-start gap-3 px-4 py-2 border-b border-stone-100 dark:border-stone-800/60 last:border-0 hover:bg-stone-50 dark:hover:bg-stone-800/30 transition-colors ${className}`}>
			<span className="w-44 shrink-0 text-xs text-stone-500 dark:text-stone-400 pt-px leading-relaxed break-all">
				{label}
			</span>
			<span
				className={`text-xs text-stone-800 dark:text-stone-200 break-all leading-relaxed min-w-0 ${
					mono ? "font-mono" : ""
				}`}
			>
				{displayValue}
			</span>
		</div>
	);
}

export default function AttributesTab({
	normalizedItem,
	spanAttributes,
}: {
	normalizedItem: TransformedTraceRow;
	spanAttributes: Record<string, string | number>;
}) {
	const groups = ATTR_GROUPS.map((group) => ({
		label: group.label,
		entries: group.keys
			.filter((key) => {
				if (CODE_ITEM_KEY_SET.has(key)) return false;
				const value = normalizedItem[key];
				if (isNil(value) || value === "" || value === TraceMapping[key]?.defaultValue)
					return false;
				return true;
			})
			.map((key) => {
				const mapping = TraceMapping[key];
				const prefix = mapping?.valuePrefix ?? "";
				const suffix = mapping?.valueSuffix ?? "";
				return {
					key,
					label: mapping?.isRoot ? key : (() => { const fp = getTraceMappingKeyFullPath(key); return Array.isArray(fp) ? fp.join(".") : (fp as string); })(),
					value: `${prefix}${normalizedItem[key]}${suffix}`,
				};
			}),
	})).filter((g) => g.entries.length > 0);

	const customEntries = Object.entries(spanAttributes).filter(
		([key, value]) =>
			!KNOWN_SPAN_ATTR_KEYS.has(key) &&
			!isNil(value) &&
			String(value).length > 0
	);

	const hasContent = groups.length > 0 || customEntries.length > 0;

	if (!hasContent) {
		return (
			<div className="flex items-center justify-center h-24 text-sm text-stone-400 dark:text-stone-500">
				No span attributes
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{groups.map((group) => (
				<div key={group.label}>
					<GroupHeader label={group.label} />
					{group.entries.map(({ key, label, value }) => (
						<AttrRow key={key} label={label} value={value} />
					))}
				</div>
			))}
			{customEntries.length > 0 && (
				<div>
					<GroupHeader label="Custom" />
					{customEntries.map(([key, value]) => (
						<AttrRow key={key} label={key} value={value} mono />
					))}
				</div>
			)}
		</div>
	);
}
