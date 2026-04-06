import {
	AudioLines,
	BookKey,
	Boxes,
	Braces,
	Brain,
	CircleDollarSign,
	CircleGauge,
	ClipboardType,
	Code2,
	Combine,
	Container,
	Crop,
	Database,
	DoorClosed,
	Factory,
	FileAudio2,
	FileCog,
	FileStack,
	Fingerprint,
	Hammer,
	Hash,
	ImageIcon,
	Layers,
	MessageSquare,
	MessageSquareWarning,
	PyramidIcon,
	Radio,
	ScanSearch,
	ShieldCheck,
	Sliders,
	SquareCode,
	SquareRadical,
	TicketCheck,
	TicketPlus,
	Timer,
	User,
} from "lucide-react";
import { objectKeys } from "@/utils/object";
import { isArray } from "lodash";
import {
	SPAN_KIND_TYPE,
	TraceMappingKeyType,
	TraceMappingValueType,
} from "@/types/trace";

const SpanAttributesGenAIPrefix = "gen_ai";
const SpanAttributesDBPrefix = "db";

export const TraceMapping: Record<TraceMappingKeyType, TraceMappingValueType> =
	{
		// Root Key
		time: {
			label: "Time",
			type: "date",
			path: "Timestamp",
			isRoot: true,
		},
		requestDuration: {
			label: "Request Duration",
			type: "float",
			path: "Duration",
			isRoot: true,
			offset: 10e-10,
			valueSuffix: "s",
		},

		id: {
			label: "Id",
			type: "string",
			path: "TraceId",
			isRoot: true,
		},

		parentSpanId: {
			label: "Parent Span Id",
			type: "string",
			path: "ParentSpanId",
			isRoot: true,
		},

		statusCode: {
			label: "Status Code",
			type: "string",
			path: "StatusCode",
			isRoot: true,
		},
		applicationName: {
			label: "App Name",
			type: "string",
			path: ["SpanAttributes", "gen_ai.application_name"],
			isRoot: true,
		},
		environment: {
			label: "Environment",
			type: "string",
			path: ["SpanAttributes", "gen_ai.environment"],
			icon: Container,
			isRoot: true,
		},

		// Exception
		serviceName: {
			label: "Service Name",
			type: "string",
			path: "ServiceName",
			isRoot: true,
			icon: FileCog,
		},
		statusMessage: {
			label: "Error Message",
			type: "string",
			path: "StatusMessage",
			isRoot: true,
		},
		spanId: {
			label: "Span Id",
			type: "string",
			path: "SpanId",
			isRoot: true,
		},
		spanName: {
			label: "Span Name",
			type: "string",
			path: "SpanName",
			isRoot: true,
		},
		exceptionType: {
			label: "Exception type",
			type: "string",
			path: ["Events.Attributes", "0", "exception.type"],
			icon: MessageSquareWarning,
			isRoot: true,
		},
		deploymentType: {
			label: "Deployment type",
			type: "string",
			path: ["ResourceAttributes", "deployment.environment"],
			icon: Container,
			isRoot: true,
		},

		provider: {
			label: "Provider",
			type: "string",
			path: "system",
			prefix: SpanAttributesGenAIPrefix,
			icon: PyramidIcon,
		},
		type: {
			label: "Type",
			type: "string",
			path: "operation.name",
			prefix: SpanAttributesGenAIPrefix,
			icon: ClipboardType,
		},
		endpoint: {
			label: "Endpoint",
			type: "string",
			path: "endpoint",
			prefix: SpanAttributesGenAIPrefix,
			icon: DoorClosed,
		},
		temperature: {
			label: "Temperature",
			type: "float",
			path: "request.temperature",
			prefix: SpanAttributesGenAIPrefix,
			icon: Sliders,
		},

		// Tokens & Cost
		cost: {
			label: "Usage Cost",
			type: "round",
			path: "usage.cost",
			prefix: SpanAttributesGenAIPrefix,
			icon: CircleDollarSign,
			offset: 10,
			defaultValue: "-",
			valuePrefix: "$",
		},

		promptTokens: {
			label: "Prompt Tokens",
			type: "integer",
			path: "usage.input_tokens",
			prefix: SpanAttributesGenAIPrefix,
			icon: Braces,
			defaultValue: "-",
		},
		completionTokens: {
			label: "Completion Tokens",
			type: "integer",
			path: "usage.output_tokens",
			prefix: SpanAttributesGenAIPrefix,
			defaultValue: "-",
		},
		totalTokens: {
			label: "Total Tokens",
			type: "integer",
			path: "usage.total_tokens",
			prefix: SpanAttributesGenAIPrefix,
			icon: TicketPlus,
			defaultValue: "-",
		},
		maxTokens: {
			label: "Maximum tokens",
			type: "integer",
			path: "request.max_tokens",
			prefix: SpanAttributesGenAIPrefix,
			icon: TicketCheck,
			defaultValue: "-",
		},

		// Audio

		audioVoice: {
			label: "Audio Voice",
			type: "string",
			path: "request.audio_voice",
			prefix: SpanAttributesGenAIPrefix,
			icon: AudioLines,
		},
		audioFormat: {
			label: "Audio Format",
			type: "string",
			path: "request.audio_response_format",
			prefix: SpanAttributesGenAIPrefix,
			icon: FileAudio2,
		},
		audioSpeed: {
			label: "Audio Speed",
			type: "string",
			path: "request.audio_speed",
			prefix: SpanAttributesGenAIPrefix,
			icon: CircleGauge,
		},

		// Image

		image: {
			label: "Image",
			type: "string",
			path: "response.image.0",
			prefix: SpanAttributesGenAIPrefix,
		},
		imageSize: {
			label: "Image Size",
			type: "string",
			path: "request.image_size",
			prefix: SpanAttributesGenAIPrefix,
			icon: ImageIcon,
		},
		imageQuality: {
			label: "Image Quality",
			type: "string",
			path: "request.image_quality",
			prefix: SpanAttributesGenAIPrefix,
			icon: ScanSearch,
		},
		imageStyle: {
			label: "Image Style",
			type: "string",
			path: "request.image_style",
			prefix: SpanAttributesGenAIPrefix,
			icon: Crop,
		},

		// Request and Response
		model: {
			label: "Model",
			type: "string",
			path: "request.model",
			prefix: SpanAttributesGenAIPrefix,
			icon: Boxes,
		},
		prompt: {
			label: "Prompt",
			type: "string",
			path: ["Events.Attributes", "0", "gen_ai.prompt"],
			isRoot: true,
		},
		finishReason: {
			label: "Finish Reason",
			type: "string",
			path: "response.finish_reasons",
			prefix: SpanAttributesGenAIPrefix,
		},
		response: {
			label: "Response",
			type: "string",
			path: ["Events.Attributes", "1", "gen_ai.completion"],
			isRoot: true,
		},
		randomSeed: {
			label: "Random seed",
			type: "float",
			path: "request.seed",
			prefix: SpanAttributesGenAIPrefix,
		},
		revisedPrompt: {
			label: "Revised Prompt",
			type: "string",
			path: ["SpanAttributes", "gen_ai.content.revised_prompt"],
			isRoot: true,
		},

		// Embedding

		embeddingFormat: {
			label: "Embedding Format",
			type: "string",
			path: "request.encoding_formats",
			prefix: SpanAttributesGenAIPrefix,
		},
		embeddingDimension: {
			label: "Embedding Dimension",
			type: "string",
			path: "request.embedding_dimension",
			prefix: SpanAttributesGenAIPrefix,
		},

		// Fine tune
		trainingFile: {
			label: "Training File",
			type: "string",
			path: "request.training_file",
			prefix: SpanAttributesGenAIPrefix,
		},
		validationFile: {
			label: "Validation File",
			type: "string",
			path: "request.validation_file",
			prefix: SpanAttributesGenAIPrefix,
		},
		fineTuneBatchSize: {
			label: "Fine Tune Batch Size",
			type: "string",
			path: "request.fine_tune_batch_size",
			prefix: SpanAttributesGenAIPrefix,
		},
		learningRateMultiplier: {
			label: "Learning rate multiplier",
			type: "string",
			path: "request.learning_rate_multiplier",
			prefix: SpanAttributesGenAIPrefix,
		},
		fineTuneNEpochs: {
			label: "Fine Tune and Epochs",
			type: "string",
			path: "request.fine_tune_n_epochs",
			prefix: SpanAttributesGenAIPrefix,
		},
		fineTuneModelSuffix: {
			label: "Fine Tune Model Suffix",
			type: "string",
			path: "request.fine_tune_model_suffix",
			prefix: SpanAttributesGenAIPrefix,
		},
		finetuneJobStatus: {
			label: "Fine Tune Job Status",
			type: "string",
			path: "request.fine_tune_status",
			prefix: SpanAttributesGenAIPrefix,
		},

		// vector db
		operation: {
			label: "Operation",
			type: "string",
			path: "operation",
			prefix: SpanAttributesDBPrefix,
			icon: SquareRadical,
		},
		system: {
			label: "Provider",
			type: "string",
			path: "system",
			prefix: SpanAttributesDBPrefix,
			icon: PyramidIcon,
		},
		documentsCount: {
			label: "Documents count",
			type: "integer",
			path: "documents_count",
			prefix: SpanAttributesDBPrefix,
			icon: FileStack,
		},
		idsCount: {
			label: "Ids count",
			type: "integer",
			path: "ids_count",
			prefix: SpanAttributesDBPrefix,
			icon: Fingerprint,
		},
		vectorCount: {
			label: "Vector count",
			type: "integer",
			path: "vector_count",
			prefix: SpanAttributesDBPrefix,
			icon: Factory,
		},
		statement: {
			label: "Statement",
			type: "string",
			path: "statement",
			prefix: SpanAttributesDBPrefix,
		},
		nResults: {
			label: "N results",
			type: "string",
			path: "n_results",
			prefix: SpanAttributesDBPrefix,
		},
		collectionName: {
			label: "Collection Name",
			type: "string",
			path: "collection.name",
			prefix: SpanAttributesDBPrefix,
			icon: Combine,
		},
		whereDocument: {
			label: "Where Document",
			type: "string",
			path: "where_document",
			prefix: SpanAttributesDBPrefix,
		},
		filter: {
			label: "Filter",
			type: "string",
			path: "filter",
			prefix: SpanAttributesDBPrefix,
		},

		// framework
		owner: {
			label: "Hub Owner",
			type: "string",
			path: "hub.owner",
			prefix: SpanAttributesGenAIPrefix,
			icon: ShieldCheck,
		},
		repo: {
			label: "Hub Repo",
			type: "string",
			path: "hub.repo",
			prefix: SpanAttributesGenAIPrefix,
			icon: BookKey,
		},
		retrievalSource: {
			label: "Retrieval Source",
			type: "string",
			path: "retrieval.source",
			prefix: SpanAttributesGenAIPrefix,
			icon: SquareCode,
		},

		// ── Request sampling / generation params ────────────────────────
		requestTopP: {
			label: "Top P",
			type: "float",
			path: "request.top_p",
			prefix: SpanAttributesGenAIPrefix,
			icon: Sliders,
		},
		requestTopK: {
			label: "Top K",
			type: "float",
			path: "request.top_k",
			prefix: SpanAttributesGenAIPrefix,
			icon: Sliders,
		},
		requestFrequencyPenalty: {
			label: "Frequency Penalty",
			type: "float",
			path: "request.frequency_penalty",
			prefix: SpanAttributesGenAIPrefix,
			icon: Sliders,
		},
		requestPresencePenalty: {
			label: "Presence Penalty",
			type: "float",
			path: "request.presence_penalty",
			prefix: SpanAttributesGenAIPrefix,
			icon: Sliders,
		},
		requestIsStream: {
			label: "Streaming",
			type: "string",
			path: "request.is_stream",
			prefix: SpanAttributesGenAIPrefix,
			icon: Radio,
		},
		requestUser: {
			label: "User",
			type: "string",
			path: "request.user",
			prefix: SpanAttributesGenAIPrefix,
			icon: User,
		},
		requestChoiceCount: {
			label: "Choice Count",
			type: "integer",
			path: "request.choice.count",
			prefix: SpanAttributesGenAIPrefix,
			icon: Hash,
		},
		requestStopSequences: {
			label: "Stop Sequences",
			type: "string",
			path: "request.stop_sequences",
			prefix: SpanAttributesGenAIPrefix,
		},
		requestToolChoice: {
			label: "Tool Choice",
			type: "string",
			path: "request.tool_choice",
			prefix: SpanAttributesGenAIPrefix,
			icon: Hammer,
		},

		// ── Response attributes ──────────────────────────────────────────
		responseId: {
			label: "Response ID",
			type: "string",
			path: "response.id",
			prefix: SpanAttributesGenAIPrefix,
			icon: Hash,
		},
		responseModel: {
			label: "Response Model",
			type: "string",
			path: "response.model",
			prefix: SpanAttributesGenAIPrefix,
			icon: Boxes,
		},
		outputType: {
			label: "Output Type",
			type: "string",
			path: "output.type",
			prefix: SpanAttributesGenAIPrefix,
			icon: Code2,
		},

		// ── Tool calling ─────────────────────────────────────────────────
		toolName: {
			label: "Tool Name",
			type: "string",
			path: "tool.name",
			prefix: SpanAttributesGenAIPrefix,
			icon: Hammer,
		},
		toolCallId: {
			label: "Tool Call ID",
			type: "string",
			path: "tool.call.id",
			prefix: SpanAttributesGenAIPrefix,
			icon: Hash,
		},
		toolArgs: {
			label: "Tool Arguments",
			type: "string",
			path: "tool.args",
			prefix: SpanAttributesGenAIPrefix,
		},

		// ── Token details ────────────────────────────────────────────────
		cacheReadTokens: {
			label: "Cache Read Tokens",
			type: "integer",
			path: "usage.cache_read.input_tokens",
			prefix: SpanAttributesGenAIPrefix,
			icon: Database,
			defaultValue: "-",
		},
		cacheCreationTokens: {
			label: "Cache Creation Tokens",
			type: "integer",
			path: "usage.cache_creation.input_tokens",
			prefix: SpanAttributesGenAIPrefix,
			icon: Database,
			defaultValue: "-",
		},
		reasoningTokens: {
			label: "Reasoning Tokens",
			type: "integer",
			path: "usage.completion_tokens_details.reasoning_tokens",
			prefix: SpanAttributesGenAIPrefix,
			icon: Brain,
			defaultValue: "-",
		},

		// ── Streaming latency ────────────────────────────────────────────
		ttft: {
			label: "Time to First Token",
			type: "float",
			path: "server.time_to_first_token",
			prefix: SpanAttributesGenAIPrefix,
			icon: Timer,
			valueSuffix: "s",
		},
		tbt: {
			label: "Time Per Output Token",
			type: "float",
			path: "server.time_per_output_token",
			prefix: SpanAttributesGenAIPrefix,
			icon: Timer,
			valueSuffix: "s",
		},

		// ── Content ──────────────────────────────────────────────────────
		systemInstructions: {
			label: "System Instructions",
			type: "string",
			path: "system_instructions",
			prefix: SpanAttributesGenAIPrefix,
			icon: MessageSquare,
		},
		contentReasoning: {
			label: "Reasoning Content",
			type: "string",
			path: "content.reasoning",
			prefix: SpanAttributesGenAIPrefix,
			icon: Brain,
		},

		// ── Reasoning / effort ───────────────────────────────────────────
		reasoningEffort: {
			label: "Reasoning Effort",
			type: "string",
			path: "request.reasoning_effort",
			prefix: SpanAttributesGenAIPrefix,
			icon: Brain,
		},

		// ── OpenAI-specific ──────────────────────────────────────────────
		openaiApiType: {
			label: "API Type",
			type: "string",
			path: "api.type",
			prefix: "openai",
			icon: Code2,
		},
		openaiRequestServiceTier: {
			label: "Service Tier (Req)",
			type: "string",
			path: "request.service_tier",
			prefix: "openai",
			icon: Layers,
		},
		openaiResponseServiceTier: {
			label: "Service Tier (Res)",
			type: "string",
			path: "response.service_tier",
			prefix: "openai",
			icon: Layers,
		},
		openaiSystemFingerprint: {
			label: "System Fingerprint",
			type: "string",
			path: "response.system_fingerprint",
			prefix: "openai",
			icon: Fingerprint,
		},

		// ── DB (new OTel paths) ──────────────────────────────────────────
		dbSystemName: {
			label: "DB System",
			type: "string",
			path: "system.name",
			prefix: SpanAttributesDBPrefix,
			icon: Database,
		},
		dbOperationName: {
			label: "DB Operation",
			type: "string",
			path: "operation.name",
			prefix: SpanAttributesDBPrefix,
			icon: SquareRadical,
		},
		dbQueryText: {
			label: "Query",
			type: "string",
			path: "query.text",
			prefix: SpanAttributesDBPrefix,
			icon: SquareCode,
		},
	};

function getReverseTraceMapping(): Record<string, TraceMappingKeyType> {
	return objectKeys(TraceMapping).reduce(
		(acc: Record<string, TraceMappingKeyType>, key) => {
			const path: string = isArray(TraceMapping[key].path)
				? (TraceMapping[key].path as string[]).join(",")
				: (TraceMapping[key].path as string);
			acc[path] = key;
			return acc;
		},
		{}
	);
}

/**
 * This Reverse Trace Mapping is for getting the mapping from path of a key in the trace request to the mapping key in the TraceMapping object in order to
 */
export const ReverseTraceMapping = getReverseTraceMapping();

export const SPAN_KIND: Record<SPAN_KIND_TYPE, SPAN_KIND_TYPE> = {
	SPAN_KIND_INTERNAL: "SPAN_KIND_INTERNAL", // Defines exceptions
	SPAN_KIND_CLIENT: "SPAN_KIND_CLIENT", // Define successful queries
};

export const SUPPORTED_EVALUATION_OPERATIONS = ["chat"];
