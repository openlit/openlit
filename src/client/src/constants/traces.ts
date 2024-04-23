import { ValueOf } from "@/utils/types";

export const SpanAttributesPrefix = "gen_ai";

export type TraceKeyType = "string" | "integer" | "float";

export const TraceMapping: Record<
	string,
	{
		label: string;
		type: TraceKeyType;
		path: string;
		prefix?: string;
		isRoot?: boolean;
		multiplier?: number;
	}
> = {
	// Root Key
	time: {
		label: "Time",
		type: "string",
		path: "Timestamp",
		isRoot: true,
	},

	id: {
		label: "Id",
		type: "string",
		path: "TraceId",
		isRoot: true,
	},
	provider: {
		label: "Provider",
		type: "string",
		path: "system",
		prefix: SpanAttributesPrefix,
	},
	applicationName: {
		label: "Application Name",
		type: "string",
		path: "application_name",
		prefix: SpanAttributesPrefix,
	},
	environment: {
		label: "Environment",
		type: "string",
		path: "environment",
		prefix: SpanAttributesPrefix,
	},
	type: {
		label: "Type",
		type: "string",
		path: "type",
		prefix: SpanAttributesPrefix,
	},
	endpoint: {
		label: "Endpoint",
		type: "string",
		path: "endpoint",
		prefix: SpanAttributesPrefix,
	},
	temperature: {
		label: "Temperature",
		type: "float",
		path: "temperature",
		prefix: SpanAttributesPrefix,
	},

	// Tokens & Cost
	cost: {
		label: "Cost",
		type: "float",
		path: "usage.cost",
		prefix: SpanAttributesPrefix,
	},

	promptTokens: {
		label: "Prompt Tokens",
		type: "integer",
		path: "usage.prompt_tokens",
		prefix: SpanAttributesPrefix,
	},
	completionTokens: {
		label: "Completion Tokens",
		type: "integer",
		path: "usage.completion_tokens",
		prefix: SpanAttributesPrefix,
	},
	totalTokens: {
		label: "Total Tokens",
		type: "integer",
		path: "usage.total_tokens",
		prefix: SpanAttributesPrefix,
	},
	maxTokens: {
		label: "Maximum tokens",
		type: "integer",
		path: "request.max_tokens",
		prefix: SpanAttributesPrefix,
	},

	// Audio

	audioVoice: {
		label: "Audio Voice",
		type: "string",
		path: "request.audio_voice",
		prefix: SpanAttributesPrefix,
	},
	audioFormat: {
		label: "Audio Format",
		type: "string",
		path: "request.audio_response_format",
		prefix: SpanAttributesPrefix,
	},
	audioSpeed: {
		label: "Audio Speed",
		type: "string",
		path: "request.audio_speed",
		prefix: SpanAttributesPrefix,
	},

	// Image

	image: {
		label: "Image",
		type: "string",
		path: "request.image",
		prefix: SpanAttributesPrefix,
	},
	imageSize: {
		label: "Image Size",
		type: "string",
		path: "request.image_size",
		prefix: SpanAttributesPrefix,
	},
	imageQuality: {
		label: "Image Quality",
		type: "string",
		path: "request.image_quality",
		prefix: SpanAttributesPrefix,
	},
	imageStyle: {
		label: "Image Style",
		type: "string",
		path: "request.image_style",
		prefix: SpanAttributesPrefix,
	},

	// Request and Response
	model: {
		label: "Model",
		type: "string",
		path: "request.model",
		prefix: SpanAttributesPrefix,
	},
	requestDuration: {
		label: "Request Duration",
		type: "integer",
		path: "Duration",
		isRoot: true,
		multiplier: 10e-10,
	},
	prompt: {
		label: "Prompt",
		type: "string",
		path: "content.prompt",
		prefix: SpanAttributesPrefix,
	},
	finishReason: {
		label: "Finish Reason",
		type: "string",
		path: "response.finish_reason",
		prefix: SpanAttributesPrefix,
	},
	response: {
		label: "Response",
		type: "string",
		path: "content.completion",
		prefix: SpanAttributesPrefix,
	},
	randomSeed: {
		label: "Random seed",
		type: "float",
		path: "request.seed",
		prefix: SpanAttributesPrefix,
	},

	// Embedding

	embeddingFormat: {
		label: "Embedding Format",
		type: "string",
		path: "request.embedding_format",
		prefix: SpanAttributesPrefix,
	},
	embeddingDimension: {
		label: "Embedding Dimension",
		type: "string",
		path: "request.embedding_dimension",
		prefix: SpanAttributesPrefix,
	},

	// Fine tune
	trainingFile: {
		label: "Training File",
		type: "string",
		path: "request.training_file",
		prefix: SpanAttributesPrefix,
	},
	validationFile: {
		label: "Validation File",
		type: "string",
		path: "request.validation_file",
		prefix: SpanAttributesPrefix,
	},
	fineTuneBatchSize: {
		label: "Fine Tune Batch Size",
		type: "string",
		path: "request.fine_tune_batch_size",
		prefix: SpanAttributesPrefix,
	},
	learningRateMultiplier: {
		label: "Learning rate multiplier",
		type: "string",
		path: "request.learning_rate_multiplier",
		prefix: SpanAttributesPrefix,
	},
	fineTuneNEpochs: {
		label: "Fine Tune and Epochs",
		type: "string",
		path: "request.fine_tune_n_epochs",
		prefix: SpanAttributesPrefix,
	},
	fineTuneModelSuffix: {
		label: "Fine Tune Model Suffix",
		type: "string",
		path: "request.fine_tune_model_suffix",
		prefix: SpanAttributesPrefix,
	},
	finetuneJobStatus: {
		label: "Fine Tune Job Status",
		type: "string",
		path: "request.fine_tune_status",
		prefix: SpanAttributesPrefix,
	},
};

export type TraceMappingKeyType = keyof typeof TraceMapping;

export type TransformedTraceRow = Record<keyof typeof TraceMapping, any>;

export const SPAN_KIND = {
	SPAN_KIND_INTERNAL: "SPAN_KIND_INTERNAL", // Defines exceptions
	SPAN_KIND_CLIENT: "SPAN_KIND_CLIENT", // Define successful queries
};

export interface TraceRow {
	Timestamp: Date;
	TraceId: string;
	SpanId: string;
	ParentSpanId: string;
	TraceState: string;
	SpanName: string;
	SpanKind: ValueOf<typeof SPAN_KIND>;
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
