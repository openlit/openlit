import { type LucideIcon } from "lucide-react";

export type TraceKeyType = "string" | "integer" | "float" | "round" | "date";
export type TraceMappingPathType =
	| string
	| string[]
	| {
			path: string | string[];
			prefix?: string | string[] | null;
	  };

export type TraceMappingKeyType =
	| "time"
	| "requestDuration"
	| "id"
	| "parentSpanId"
	| "statusCode"
	| "serviceName"
	| "statusMessage"
	| "spanId"
	| "spanName"
	| "exceptionType"
	| "deploymentType"
	| "provider"
	| "applicationName"
	| "environment"
	| "type"
	| "endpoint"
	| "temperature"
	| "cost"
	| "promptTokens"
	| "completionTokens"
	| "totalTokens"
	| "maxTokens"
	| "audioVoice"
	| "audioFormat"
	| "audioSpeed"
	| "image"
	| "imageSize"
	| "imageQuality"
	| "imageStyle"
	| "model"
	| "prompt"
	| "finishReason"
	| "response"
	| "randomSeed"
	| "revisedPrompt"
	| "embeddingFormat"
	| "embeddingDimension"
	| "trainingFile"
	| "validationFile"
	| "fineTuneBatchSize"
	| "learningRateMultiplier"
	| "fineTuneNEpochs"
	| "fineTuneModelSuffix"
	| "finetuneJobStatus"
	| "operation"
	| "system"
	| "documentsCount"
	| "idsCount"
	| "vectorCount"
	| "statement"
	| "nResults"
	| "collectionName"
	| "whereDocument"
	| "filter"
	| "owner"
	| "repo"
	| "retrievalSource"
	// Request sampling params
	| "requestTopP"
	| "requestTopK"
	| "requestFrequencyPenalty"
	| "requestPresencePenalty"
	| "requestIsStream"
	| "requestUser"
	| "requestChoiceCount"
	| "requestStopSequences"
	| "requestToolChoice"
	// Response attributes
	| "responseId"
	| "responseModel"
	| "outputType"
	// Tool calling
	| "toolName"
	| "toolCallId"
	| "toolArgs"
	// Token details
	| "cacheReadTokens"
	| "cacheCreationTokens"
	| "reasoningTokens"
	// Streaming latency
	| "ttft"
	| "tbt"
	// Content
	| "systemInstructions"
	| "contentReasoning"
	// OpenAI-specific
	| "reasoningEffort"
	| "openaiApiType"
	| "openaiRequestServiceTier"
	| "openaiResponseServiceTier"
	| "openaiSystemFingerprint"
	// DB (new OTel paths)
	| "dbSystemName"
	| "dbOperationName"
	| "dbQueryText";

export type TraceMappingValueType = {
	label: string;
	type: TraceKeyType;
	path: string | string[];
	paths?: TraceMappingPathType[];
	prefix?: string | string[];
	isRoot?: boolean;
	offset?: number;
	icon?: LucideIcon;
	defaultValue?: string | number | boolean;
	valuePrefix?: string;
	valueSuffix?: string;
};

export type TransformedTraceRow = Record<TraceMappingKeyType, any>;

export type SPAN_KIND_TYPE = "SPAN_KIND_INTERNAL" | "SPAN_KIND_CLIENT";

export interface TraceRow {
	Timestamp: Date;
	TraceId: string;
	SpanId: string;
	ParentSpanId: string;
	TraceState: string;
	SpanName: string;
	SpanKind: SPAN_KIND_TYPE;
	ServiceName: string;
	ResourceAttributes: Record<string, string>;
	ScopeName: string;
	ScopeVersion: string;
	SpanAttributes: Record<string, string | number>;
	Duration: string;
	StatusCode: string;
	StatusMessage: string;
	Events: {
		Timestamp: Date;
		Name: string;
		Attributes: Record<string, string>;
	}[];
	Links: {
		TraceId: string;
		SpanId: string;
		TraceState: string;
		Attributes: Record<string, string>;
	}[];
}
export interface TraceHeirarchySpan {
	TraceId?: string;
	SpanId: string;
	ParentSpanId?: string;
	SpanName: string;
	Duration: number;
	Timestamp?: string;
	StatusCode?: string;
	StatusMessage?: string;
	ServiceName?: string;
	SpanKind?: SPAN_KIND_TYPE;
	ScopeName?: string;
	ScopeVersion?: string;
	Cost?: number;
	SpanAttributes?: Record<string, string | number>;
	// ResourceAttributes carry per-process facts (e.g. `coding_agent.agent.parent_id`
	// for Cursor/Claude Code subagents whose parent linkage isn't stamped at the
	// span level). Optional because legacy SDK paths may omit them.
	ResourceAttributes?: Record<string, string | number>;
	Events?: {
		Timestamp?: Date | string;
		Name?: string;
		Attributes?: Record<string, string | number>;
	}[];
	Links?: {
		TraceId?: string;
		SpanId?: string;
		TraceState?: string;
		Attributes?: Record<string, string | number>;
	}[];
	children?: TraceHeirarchySpan[];
}
