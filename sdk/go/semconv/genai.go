// Package semconv provides semantic conventions for Gen AI observability.
// These constants align with OpenTelemetry semantic conventions for generative AI.
package semconv

// Operation Types
const (
	// GenAIOperationName is the name of the operation being performed
	GenAIOperationName = "gen_ai.operation.name"

	// GenAIOperationTypeChat represents a chat completion operation
	GenAIOperationTypeChat = "chat"
	// GenAIOperationTypeCompletion represents a text completion operation
	GenAIOperationTypeCompletion = "completion"
	// GenAIOperationTypeEmbedding represents an embedding operation
	GenAIOperationTypeEmbedding = "embedding"
	// GenAIOperationTypeImage represents an image generation operation
	GenAIOperationTypeImage = "image"
	// GenAIOperationTypeAudio represents an audio generation operation
	GenAIOperationTypeAudio = "audio"
)

// System Identifiers
const (
	// GenAISystem identifies the AI system being used
	GenAISystem = "gen_ai.system"

	// GenAISystemOpenAI represents OpenAI system
	GenAISystemOpenAI = "openai"
	// GenAISystemAnthropic represents Anthropic system
	GenAISystemAnthropic = "anthropic"
)

// Request Attributes
const (
	// GenAIRequestModel is the model name being requested
	GenAIRequestModel = "gen_ai.request.model"
	// GenAIRequestTemperature is the temperature parameter
	GenAIRequestTemperature = "gen_ai.request.temperature"
	// GenAIRequestTopP is the top_p parameter
	GenAIRequestTopP = "gen_ai.request.top_p"
	// GenAIRequestTopK is the top_k parameter
	GenAIRequestTopK = "gen_ai.request.top_k"
	// GenAIRequestMaxTokens is the maximum tokens requested
	GenAIRequestMaxTokens = "gen_ai.request.max_tokens"
	// GenAIRequestFrequencyPenalty is the frequency penalty parameter
	GenAIRequestFrequencyPenalty = "gen_ai.request.frequency_penalty"
	// GenAIRequestPresencePenalty is the presence penalty parameter
	GenAIRequestPresencePenalty = "gen_ai.request.presence_penalty"
	// GenAIRequestStopSequences are the stop sequences
	GenAIRequestStopSequences = "gen_ai.request.stop_sequences"
	// GenAIRequestSeed is the seed for deterministic generation
	GenAIRequestSeed = "gen_ai.request.seed"
	// GenAIRequestChoiceCount is the number of choices requested
	GenAIRequestChoiceCount = "gen_ai.request.choice_count"
	// GenAIRequestIsStream indicates whether the request uses streaming
	GenAIRequestIsStream = "gen_ai.request.is_stream"
	// GenAIRequestUser is the end-user identifier for the request
	GenAIRequestUser = "gen_ai.request.user"
)

// Response Attributes
const (
	// GenAIResponseModel is the actual model that generated the response
	GenAIResponseModel = "gen_ai.response.model"
	// GenAIResponseID is the unique identifier for the response
	GenAIResponseID = "gen_ai.response.id"
	// GenAIResponseFinishReasons are the reasons why generation stopped
	GenAIResponseFinishReasons = "gen_ai.response.finish_reasons"
	// GenAIResponseChoiceCount is the number of choices in response
	GenAIResponseChoiceCount = "gen_ai.response.choice_count"
)

// Usage Attributes
const (
	// GenAIUsageInputTokens is the number of input tokens
	GenAIUsageInputTokens = "gen_ai.usage.input_tokens"
	// GenAIUsageOutputTokens is the number of output tokens
	GenAIUsageOutputTokens = "gen_ai.usage.output_tokens"
	// GenAIUsageTotalTokens is the total number of tokens
	GenAIUsageTotalTokens = "gen_ai.usage.total_tokens"
	// GenAIUsageCost is the estimated cost of the operation
	GenAIUsageCost = "gen_ai.usage.cost"
	// GenAITokenType distinguishes input vs output on token usage metrics
	GenAITokenType = "gen_ai.token.type"
)

// Token Details (OpenAI specific)
const (
	// GenAIUsageCompletionTokensDetailsAudio tracks audio output tokens
	GenAIUsageCompletionTokensDetailsAudio = "gen_ai.usage.completion_tokens_details.audio"
	// GenAIUsageCompletionTokensDetailsReasoning tracks reasoning tokens
	GenAIUsageCompletionTokensDetailsReasoning = "gen_ai.usage.completion_tokens_details.reasoning"
	// GenAIUsagePromptTokensDetailsCacheRead tracks cached tokens read
	GenAIUsagePromptTokensDetailsCacheRead = "gen_ai.usage.prompt_tokens_details.cache_read"
	// GenAIUsagePromptTokensDetailsCacheWrite tracks cached tokens written
	GenAIUsagePromptTokensDetailsCacheWrite = "gen_ai.usage.prompt_tokens_details.cache_write"
)

// Message Attributes
const (
	// GenAIPrompt is the legacy prompt attribute
	GenAIPrompt = "gen_ai.prompt"
	// GenAICompletion is the legacy completion attribute
	GenAICompletion = "gen_ai.completion"
	// GenAIInputMessages are the structured input messages
	GenAIInputMessages = "gen_ai.input.messages"
	// GenAIOutputMessages are the structured output messages
	GenAIOutputMessages = "gen_ai.output.messages"
	// GenAISystemInstructions are system-level instructions
	GenAISystemInstructions = "gen_ai.system_instructions"
)

// Tool/Function Attributes
const (
	// GenAIToolDefinitions are the tool/function definitions provided
	GenAIToolDefinitions = "gen_ai.tool.definitions"
	// GenAIToolCalls are the tool/function calls made
	GenAIToolCalls = "gen_ai.tool.calls"
	// GenAIToolType is the type of tool (e.g. "function")
	GenAIToolType = "gen_ai.tool.type"
	// GenAIToolName is the comma-joined list of tool names called by the model
	GenAIToolName = "gen_ai.tool.name"
	// GenAIToolCallID is the comma-joined list of tool call IDs from the model response
	GenAIToolCallID = "gen_ai.tool.call.id"
	// GenAIToolCallArguments is the array of JSON argument strings from model tool calls
	GenAIToolCallArguments = "gen_ai.tool.call.arguments"
)

// Conversation Attributes
const (
	// GenAIConversationID identifies a conversation/session
	GenAIConversationID = "gen_ai.conversation.id"
)

// OpenAI Specific Attributes
const (
	// GenAIOpenAIAssistantID is the OpenAI assistant ID
	GenAIOpenAIAssistantID = "gen_ai.openai.assistant.id"
	// GenAIOpenAIThreadID is the OpenAI thread ID
	GenAIOpenAIThreadID = "gen_ai.openai.thread.id"
	// GenAIOpenAIRunID is the OpenAI run ID
	GenAIOpenAIRunID = "gen_ai.openai.run.id"
	// GenAIOpenAIRequestServiceTier is the requested service tier
	GenAIOpenAIRequestServiceTier = "gen_ai.openai.request.service_tier"
	// GenAIOpenAIResponseServiceTier is the actual service tier used
	GenAIOpenAIResponseServiceTier = "gen_ai.openai.response.service_tier"
	// GenAIOpenAIResponseSystemFingerprint is the system fingerprint
	GenAIOpenAIResponseSystemFingerprint = "gen_ai.openai.response.system_fingerprint"
)

// Output Type
const (
	// GenAIOutputType is the requested content type
	GenAIOutputType = "gen_ai.output.type"
	// GenAIOutputTypeText represents text output
	GenAIOutputTypeText = "text"
	// GenAIOutputTypeJSON represents JSON output
	GenAIOutputTypeJSON = "json_object"
)

// Server Attributes
const (
	// ServerAddress is the server address
	ServerAddress = "server.address"
	// ServerPort is the server port
	ServerPort = "server.port"
)

// Error Attributes
const (
	// ErrorType describes the error type
	ErrorType = "error.type"
)

// Event Names
const (
	// GenAIClientInferenceOperationDetails is the event name for operation details
	GenAIClientInferenceOperationDetails = "gen_ai.client.inference.operation.details"
	// GenAIUserMessage is the event name for user messages
	GenAIUserMessage = "gen_ai.user.message"
	// GenAISystemMessage is the event name for system messages
	GenAISystemMessage = "gen_ai.system.message"
	// GenAIAssistantMessage is the event name for assistant messages
	GenAIAssistantMessage = "gen_ai.assistant.message"
	// GenAIToolMessage is the event name for tool messages
	GenAIToolMessage = "gen_ai.tools.message"
	// GenAIChoice is the event name for choice details
	GenAIChoice = "gen_ai.choice"
)

// Metric Names
const (
	// GenAIClientTokenUsage tracks token usage
	GenAIClientTokenUsage = "gen_ai.client.token.usage"
	// GenAIClientOperationDuration tracks operation duration
	GenAIClientOperationDuration = "gen_ai.client.operation.duration"
	// GenAIServerRequestDuration tracks server request duration
	GenAIServerRequestDuration = "gen_ai.server.request.duration"
	// GenAIServerTimePerOutputToken tracks time between tokens
	GenAIServerTimePerOutputToken = "gen_ai.server.time_per_output_token"
	// GenAIServerTimeToFirstToken tracks time to first token
	GenAIServerTimeToFirstToken = "gen_ai.server.time_to_first_token"
	// GenAIClientOperationTimeToFirstChunk tracks client-side time to first chunk in streaming
	GenAIClientOperationTimeToFirstChunk = "gen_ai.client.operation.time_to_first_chunk"
	// GenAIClientOperationTimePerOutputChunk tracks per-chunk output token latency observations in streaming
	GenAIClientOperationTimePerOutputChunk = "gen_ai.client.operation.time_per_output_chunk"
)

// Environment Attributes
const (
	// OpenLITEnvironment is the deployment environment
	OpenLITEnvironment = "openlit.environment"
	// OpenLITApplicationName is the application name
	OpenLITApplicationName = "openlit.application.name"
	// OpenLITSDKVersion is the SDK version
	OpenLITSDKVersion = "openlit.sdk.version"
)
