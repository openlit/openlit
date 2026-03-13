"use client";

import { TraceMapping } from "@/constants/traces";
import {
	CODE_ITEM_DISPLAY_KEYS,
	KNOWN_SPAN_ATTR_KEYS,
} from "@/helpers/client/trace";
import { TraceMappingKeyType, TransformedTraceRow } from "@/types/trace";
import { isNil } from "lodash";
import { AttrRow, GroupHeader } from "./attributes-tab";

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

export default function SpanAttributesTab({
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
					label: mapping?.label ?? key,
					value: `${prefix}${normalizedItem[key]}${suffix}`,
				};
			}),
	})).filter((g) => g.entries.length > 0);

	const customEntries = Object.entries(spanAttributes || {}).filter(
		([key, value]) =>
			!KNOWN_SPAN_ATTR_KEYS.has(key) &&
			!isNil(value) &&
			String(value).length > 0
	);

	const hasContent = groups.length > 0 || customEntries.length > 0;

	if (!hasContent) {
		return (
			<div className="flex items-center justify-center h-16 text-sm text-stone-400 dark:text-stone-500">
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
						<AttrRow key={key} label={label} value={String(value)} />
					))}
				</div>
			))}
			{customEntries.length > 0 && (
				<div>
					<GroupHeader label="Custom" />
					{customEntries.map(([key, value]) => (
						<AttrRow key={key} label={key} value={String(value)} mono />
					))}
				</div>
			)}
		</div>
	);
}
