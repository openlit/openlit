"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Semantic conventions aligned with OpenTelemetry Gen AI spec and Python SDK.
 * Old keys are kept for backward compatibility; new OTel-aligned keys are added with _OTEL suffix.
 */
class SemanticConvention {
}
// Unstable SemConv
SemanticConvention.ATTR_DEPLOYMENT_ENVIRONMENT = 'deployment.environment';
// ----- GenAI General (legacy keys kept for backward compatibility) -----
SemanticConvention.GEN_AI_PROVIDER_NAME = 'gen_ai.system';
/** OTel standard: use for new code / future compatibility */
SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL = 'gen_ai.provider.name';
// ----- OTel Gen AI & Server/Error (new keys; legacy below unchanged) -----
SemanticConvention.GEN_AI_OPERATION = 'gen_ai.operation.name';
SemanticConvention.GEN_AI_OUTPUT_TYPE = 'gen_ai.output.type';
SemanticConvention.GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
SemanticConvention.GEN_AI_REQUEST_SEED = 'gen_ai.request.seed';
SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT = 'gen_ai.request.choice.count';
SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS = 'gen_ai.request.encoding_formats';
SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY = 'gen_ai.request.frequency_penalty';
SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS = 'gen_ai.request.max_tokens';
SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY = 'gen_ai.request.presence_penalty';
SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES = 'gen_ai.request.stop_sequences';
SemanticConvention.GEN_AI_REQUEST_TEMPERATURE = 'gen_ai.request.temperature';
SemanticConvention.GEN_AI_REQUEST_TOP_K = 'gen_ai.request.top_k';
SemanticConvention.GEN_AI_REQUEST_TOP_P = 'gen_ai.request.top_p';
SemanticConvention.GEN_AI_CONVERSATION_ID = 'gen_ai.conversation.id';
SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON = 'gen_ai.response.finish_reasons';
SemanticConvention.GEN_AI_RESPONSE_ID = 'gen_ai.response.id';
SemanticConvention.GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model';
SemanticConvention.GEN_AI_INPUT_MESSAGES = 'gen_ai.input.messages';
SemanticConvention.GEN_AI_OUTPUT_MESSAGES = 'gen_ai.output.messages';
SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS = 'gen_ai.system_instructions';
SemanticConvention.GEN_AI_TOOL_DEFINITIONS = 'gen_ai.tool.definitions';
SemanticConvention.GEN_AI_EMBEDDINGS_DIMENSION_COUNT = 'gen_ai.embeddings.dimension.count';
SemanticConvention.GEN_AI_TOKEN_TYPE = 'gen_ai.token.type';
SemanticConvention.GEN_AI_TOKEN_TYPE_INPUT = 'input';
SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT = 'output';
SemanticConvention.GEN_AI_TOKEN_TYPE_REASONING = 'reasoning';
SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION = 'gen_ai.client.operation.duration';
SemanticConvention.GEN_AI_CLIENT_OPERATION_TIME_TO_FIRST_CHUNK = 'gen_ai.client.operation.time_to_first_chunk';
/** OTel standard span attribute for TTFT */
SemanticConvention.GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK = 'gen_ai.response.time_to_first_chunk';
SemanticConvention.GEN_AI_CLIENT_OPERATION_TIME_PER_OUTPUT_CHUNK = 'gen_ai.client.operation.time_per_output_chunk';
SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE = 'gen_ai.client.token.usage';
SemanticConvention.GEN_AI_SERVER_REQUEST_DURATION = 'gen_ai.server.request.duration';
SemanticConvention.GEN_AI_SERVER_TBT = 'gen_ai.server.time_per_output_token';
SemanticConvention.GEN_AI_SERVER_TTFT = 'gen_ai.server.time_to_first_token';
SemanticConvention.SERVER_ADDRESS = 'server.address';
SemanticConvention.SERVER_PORT = 'server.port';
SemanticConvention.ERROR_TYPE = 'error.type';
SemanticConvention.ERROR_TYPE_UNAVAILABLE = 'unavailable';
SemanticConvention.ERROR_TYPE_AUTHENTICATION = 'authentication';
SemanticConvention.ERROR_TYPE_TIMEOUT = 'timeout';
SemanticConvention.ERROR_TYPE_RATE_LIMITED = 'rate_limited';
SemanticConvention.ERROR_TYPE_PERMISSION = 'permission';
SemanticConvention.ERROR_TYPE_NOT_FOUND = 'not_found';
SemanticConvention.ERROR_TYPE_INVALID_REQUEST = 'invalid_request';
SemanticConvention.ERROR_TYPE_SERVER_ERROR = 'server_error';
// GenAI event names (OTel)
SemanticConvention.GEN_AI_USER_MESSAGE = 'gen_ai.user.message';
SemanticConvention.GEN_AI_SYSTEM_MESSAGE = 'gen_ai.system.message';
SemanticConvention.GEN_AI_ASSISTANT_MESSAGE = 'gen_ai.assistant.message';
SemanticConvention.GEN_AI_TOOL_MESSAGE = 'gen_ai.tools.message';
SemanticConvention.GEN_AI_CHOICE = 'gen_ai.choice';
SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS = 'gen_ai.client.inference.operation.details';
// ----- GenAI General (OpenLIT + OTel) -----
SemanticConvention.GEN_AI_ENDPOINT = 'gen_ai.endpoint';
SemanticConvention.GEN_AI_ENVIRONMENT = 'gen_ai.environment';
SemanticConvention.GEN_AI_APPLICATION_NAME = 'gen_ai.application_name';
SemanticConvention.GEN_AI_HUB_OWNER = 'gen_ai.hub.owner';
SemanticConvention.GEN_AI_HUB_REPO = 'gen_ai.hub.repo';
SemanticConvention.GEN_AI_RETRIEVAL_SOURCE = 'gen_ai.retrieval.source';
SemanticConvention.GEN_AI_REQUESTS = 'gen_ai.total.requests';
SemanticConvention.GEN_AI_SDK_VERSION = 'gen_ai.sdk.version';
// GenAI Request (extended / OpenLIT)
SemanticConvention.GEN_AI_REQUEST_IS_STREAM = 'gen_ai.request.is_stream';
/** OTel standard: gen_ai.request.stream (replaces gen_ai.request.is_stream) */
SemanticConvention.GEN_AI_REQUEST_STREAM = 'gen_ai.request.stream';
SemanticConvention.GEN_AI_REQUEST_USER = 'gen_ai.request.user';
SemanticConvention.GEN_AI_REQUEST_EMBEDDING_DIMENSION = 'gen_ai.request.embedding_dimension';
SemanticConvention.GEN_AI_REQUEST_TOOL_CHOICE = 'gen_ai.request.tool_choice';
SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE = 'gen_ai.request.audio_voice';
SemanticConvention.GEN_AI_REQUEST_AUDIO_SETTINGS = 'gen_ai.request.audio_settings';
SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT = 'gen_ai.request.audio_response_format';
SemanticConvention.GEN_AI_REQUEST_AUDIO_SPEED = 'gen_ai.request.audio_speed';
SemanticConvention.GEN_AI_REQUEST_FINETUNE_STATUS = 'gen_ai.request.fine_tune_status';
SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_SUFFIX = 'gen_ai.request.fine_tune_model_suffix';
SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_EPOCHS = 'gen_ai.request.fine_tune_n_epochs';
SemanticConvention.GEN_AI_REQUEST_FINETUNE_MODEL_LRM = 'gen_ai.request.learning_rate_multiplier';
SemanticConvention.GEN_AI_REQUEST_FINETUNE_BATCH_SIZE = 'gen_ai.request.fine_tune_batch_size';
SemanticConvention.GEN_AI_REQUEST_VALIDATION_FILE = 'gen_ai.request.validation_file';
SemanticConvention.GEN_AI_REQUEST_TRAINING_FILE = 'gen_ai.request.training_file';
SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE = 'gen_ai.request.image_size';
SemanticConvention.GEN_AI_REQUEST_IMAGE_QUALITY = 'gen_ai.request.image_quality';
SemanticConvention.GEN_AI_REQUEST_IMAGE_STYLE = 'gen_ai.request.image_style';
SemanticConvention.GEN_AI_REQUEST_SAFE_PROMPT = 'gen_ai.request.safe_prompt';
SemanticConvention.GEN_AI_REQUEST_REASONING_EFFORT = 'gen_ai.request.reasoning_effort';
/** Legacy key for reading duration from span attributes */
SemanticConvention.GEN_AI_DURATION_LEGACY = 'gen_ai.duration';
// GenAI Usage
SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS = 'gen_ai.usage.total_tokens';
SemanticConvention.GEN_AI_USAGE_COST = 'gen_ai.usage.cost';
SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS = 'gen_ai.usage.reasoning_tokens';
// Enhanced token details (for prompt caching, audio tokens, etc.)
SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_AUDIO = 'gen_ai.usage.completion_tokens_details.audio';
SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_REASONING = 'gen_ai.usage.completion_tokens_details.reasoning';
SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_READ = 'gen_ai.usage.prompt_tokens_details.cache_read';
SemanticConvention.GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_WRITE = 'gen_ai.usage.prompt_tokens_details.cache_write';
// OTel semconv standard cache token attribute names (aligned with Python SDK)
SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS = 'gen_ai.usage.cache_creation.input_tokens';
SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS = 'gen_ai.usage.cache_read.input_tokens';
// GenAI Response (extended)
SemanticConvention.GEN_AI_RESPONSE_IMAGE = 'gen_ai.response.image';
SemanticConvention.GEN_AI_RESPONSE_IMAGE_SIZE = 'gen_ai.request.image_size';
SemanticConvention.GEN_AI_RESPONSE_IMAGE_QUALITY = 'gen_ai.request.image_quality';
SemanticConvention.GEN_AI_RESPONSE_IMAGE_STYLE = 'gen_ai.request.image_style';
// OpenAI-specific attributes (openai.* namespace per OTel semconv)
SemanticConvention.OPENAI_REQUEST_SERVICE_TIER = 'openai.request.service_tier';
SemanticConvention.OPENAI_RESPONSE_SERVICE_TIER = 'openai.response.service_tier';
SemanticConvention.OPENAI_RESPONSE_SYSTEM_FINGERPRINT = 'openai.response.system_fingerprint';
SemanticConvention.OPENAI_API_TYPE = 'openai.api.type';
/** @deprecated Use OPENAI_RESPONSE_SYSTEM_FINGERPRINT for OpenAI */
SemanticConvention.GEN_AI_RESPONSE_SYSTEM_FINGERPRINT = 'gen_ai.response.system_fingerprint';
// GenAI Content
SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT = 'gen_ai.content.prompt';
SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT = 'gen_ai.content.completion';
SemanticConvention.GEN_AI_CONTENT_REVISED_PROMPT = 'gen_ai.content.revised_prompt';
SemanticConvention.GEN_AI_CONTENT_REASONING = 'gen_ai.content.reasoning';
// Tool attributes (legacy: gen_ai.tool.call.type; OTel: gen_ai.tool.type)
SemanticConvention.GEN_AI_TOOL_NAME = 'gen_ai.tool.name';
SemanticConvention.GEN_AI_TOOL_TYPE = 'gen_ai.tool.call.type';
/** OTel standard */
SemanticConvention.GEN_AI_TOOL_TYPE_OTEL = 'gen_ai.tool.type';
SemanticConvention.GEN_AI_TOOL_DESCRIPTION = 'gen_ai.tool.description';
SemanticConvention.GEN_AI_TOOL_DEFINITION = 'gen_ai.tool.definition';
SemanticConvention.GEN_AI_TOOL_CALL_ID = 'gen_ai.tool.call.id';
SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS = 'gen_ai.tool.call.arguments';
SemanticConvention.GEN_AI_TOOL_CALL_RESULT = 'gen_ai.tool.call.result';
SemanticConvention.GEN_AI_TOOL_INPUT = 'gen_ai.tool.input';
SemanticConvention.GEN_AI_TOOL_OUTPUT = 'gen_ai.tool.output';
SemanticConvention.GEN_AI_TOOL_ARGS = 'gen_ai.tool.args';
// Retrieval (framework / RAG)
SemanticConvention.GEN_AI_RETRIEVAL_QUERY = 'gen_ai.retrieval.query';
SemanticConvention.GEN_AI_RETRIEVAL_QUERY_TEXT = 'gen_ai.retrieval.query.text';
SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENTS = 'gen_ai.retrieval.documents';
SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENT_COUNT = 'gen_ai.retrieval.document_count';
SemanticConvention.GEN_AI_DATA_SOURCE_ID = 'gen_ai.data_source.id';
SemanticConvention.GEN_AI_RAG_SIMILARITY_THRESHOLD = 'gen_ai.rag.similarity_threshold';
SemanticConvention.GEN_AI_RAG_DOCUMENTS_PATH = 'gen_ai.rag.documents_path';
SemanticConvention.GEN_AI_RAG_FILE_IDS = 'gen_ai.rag.file_ids';
SemanticConvention.GEN_AI_RAG_MAX_NEIGHBORS = 'gen_ai.rag.max_neighbors';
SemanticConvention.GEN_AI_RAG_MAX_SEGMENTS = 'gen_ai.rag.max_segments';
SemanticConvention.GEN_AI_RAG_STRATEGY = 'gen_ai.rag.strategy';
// Agent (OTel Semconv)
SemanticConvention.GEN_AI_AGENT_NAME = 'gen_ai.agent.name';
SemanticConvention.GEN_AI_AGENT_ID = 'gen_ai.agent.id';
SemanticConvention.GEN_AI_AGENT_DESCRIPTION = 'gen_ai.agent.description';
SemanticConvention.GEN_AI_AGENT_VERSION = 'gen_ai.agent.version';
// OpenLIT vendor extension: auto-computed canonical fingerprint over the
// parts of an agent's definition that meaningfully change its behavior
// (system prompt + tools + primary model + sampling config). Stamped on
// every chat span/event so the server can group traffic by version.
SemanticConvention.OPENLIT_AGENT_VERSION_HASH = 'openlit.agent.version_hash';
SemanticConvention.GEN_AI_AGENT_SOURCE = 'gen_ai.agent.source';
SemanticConvention.GEN_AI_AGENT_ACTION_TOOL = 'gen_ai.agent.action.tool';
SemanticConvention.GEN_AI_AGENT_ACTION_TOOL_INPUT = 'gen_ai.agent.action.tool_input';
SemanticConvention.GEN_AI_AGENT_ACTION_LOG = 'gen_ai.agent.action.log';
SemanticConvention.GEN_AI_AGENT_FINISH_OUTPUT = 'gen_ai.agent.finish.output';
SemanticConvention.GEN_AI_AGENT_FINISH_LOG = 'gen_ai.agent.finish.log';
// Workflow / framework
SemanticConvention.GEN_AI_WORKFLOW_INPUT = 'gen_ai.workflow.input';
SemanticConvention.GEN_AI_WORKFLOW_OUTPUT = 'gen_ai.workflow.output';
SemanticConvention.GEN_AI_WORKFLOW_TYPE = 'gen_ai.workflow.type';
SemanticConvention.GEN_AI_WORKFLOW_NAME = 'gen_ai.workflow.name';
SemanticConvention.GEN_AI_FRAMEWORK_ERROR_CLASS = 'gen_ai.framework.error.class';
SemanticConvention.GEN_AI_FRAMEWORK_ERROR_TYPE = 'gen_ai.framework.error.type';
SemanticConvention.GEN_AI_FRAMEWORK_ERROR_MESSAGE = 'gen_ai.framework.error.message';
SemanticConvention.GEN_AI_SERIALIZED_NAME = 'gen_ai.serialized.name';
SemanticConvention.GEN_AI_SERIALIZED_SIGNATURE = 'gen_ai.serialized.signature';
SemanticConvention.GEN_AI_SERIALIZED_DOC = 'gen_ai.serialized.doc';
SemanticConvention.GEN_AI_SERIALIZED_MODULE = 'gen_ai.serialized.module';
SemanticConvention.GEN_AI_REQUEST_PROVIDER = 'gen_ai.request.provider';
SemanticConvention.GEN_AI_DATA_SOURCES = 'gen_ai.data_source_count';
SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION = 'text_completion';
SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT = 'chat';
SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING = 'embeddings';
SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE = 'image';
SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO = 'audio';
SemanticConvention.GEN_AI_OPERATION_TYPE_FINETUNING = 'fine_tuning';
SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB = 'vectordb';
SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK = 'invoke_workflow';
SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT = 'invoke_agent';
SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS = 'execute_tool';
SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE = 'retrieval';
SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY = 'memory';
// GenAI Output Types
SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT = 'text';
SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON = 'json';
SemanticConvention.GEN_AI_OUTPUT_TYPE_IMAGE = 'image';
SemanticConvention.GEN_AI_OUTPUT_TYPE_SPEECH = 'speech';
SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE = 'huggingface';
SemanticConvention.GEN_AI_SYSTEM_REPLICATE = 'replicate';
SemanticConvention.GEN_AI_SYSTEM_OPENAI = 'openai';
SemanticConvention.GEN_AI_SYSTEM_AZURE_OPENAI = 'azure.ai.openai';
SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC = 'anthropic';
SemanticConvention.GEN_AI_SYSTEM_COHERE = 'cohere';
SemanticConvention.GEN_AI_SYSTEM_MISTRAL = 'mistral_ai';
SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK = 'aws.bedrock';
SemanticConvention.GEN_AI_SYSTEM_VERTEXAI = 'vertex_ai';
SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN = 'langchain';
SemanticConvention.GEN_AI_SYSTEM_VERCEL_AI = 'vercel_ai';
SemanticConvention.GEN_AI_SYSTEM_OLLAMA = 'ollama';
SemanticConvention.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO = 'gcp.gemini';
SemanticConvention.GEN_AI_SYSTEM_GROQ = 'groq';
SemanticConvention.GEN_AI_SYSTEM_AI21 = 'ai21';
SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN = 'digitalocean';
SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE = 'azure.ai.inference';
SemanticConvention.GEN_AI_SYSTEM_LLAMAINDEX = 'llamaindex';
SemanticConvention.GEN_AI_SYSTEM_TOGETHER = 'together';
SemanticConvention.GEN_AI_SYSTEM_LANGGRAPH = 'langgraph';
SemanticConvention.GEN_AI_SYSTEM_OPENAI_AGENTS = 'openai_agents';
SemanticConvention.GEN_AI_SYSTEM_MASTRA = 'mastra';
SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK = 'claude_agent_sdk';
SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK = 'google_adk';
SemanticConvention.GEN_AI_SYSTEM_STRANDS = 'strands_agents';
SemanticConvention.GEN_AI_SYSTEM_CURSOR = 'cursor';
SemanticConvention.GEN_AI_SYSTEM_ELEVENLABS = 'elevenlabs';
SemanticConvention.GEN_AI_SYSTEM_MCP = 'mcp';
SemanticConvention.GEN_AI_SYSTEM_MEM0 = 'mem0';
// ----- MCP (Model Context Protocol) -----
// Operation types
SemanticConvention.GEN_AI_OPERATION_TYPE_MCP_TOOL_CALL = 'mcp_tool_call';
SemanticConvention.GEN_AI_OPERATION_TYPE_MCP_TOOL_LIST = 'mcp_tool_list';
SemanticConvention.GEN_AI_OPERATION_TYPE_MCP_RESOURCE_READ = 'mcp_resource_read';
SemanticConvention.GEN_AI_OPERATION_TYPE_MCP_RESOURCE_LIST = 'mcp_resource_list';
SemanticConvention.GEN_AI_OPERATION_TYPE_MCP_REQUEST = 'mcp_request';
SemanticConvention.GEN_AI_OPERATION_TYPE_MCP_RESPONSE = 'mcp_response';
SemanticConvention.GEN_AI_OPERATION_TYPE_MCP_SERVER = 'mcp_server';
SemanticConvention.GEN_AI_OPERATION_TYPE_MCP_CLIENT = 'mcp_client';
// Core MCP attributes
SemanticConvention.MCP_OPERATION = 'mcp.operation.name';
SemanticConvention.MCP_SYSTEM = 'mcp.system';
SemanticConvention.MCP_SDK_VERSION = 'mcp.sdk.version';
SemanticConvention.MCP_METHOD = 'mcp.method';
SemanticConvention.MCP_MESSAGE_ID = 'mcp.message_id';
SemanticConvention.MCP_JSONRPC_VERSION = 'mcp.jsonrpc_version';
SemanticConvention.MCP_PARAMS = 'mcp.params';
SemanticConvention.MCP_RESULT = 'mcp.result';
// MCP error attributes
SemanticConvention.MCP_ERROR_CODE = 'mcp.error.code';
SemanticConvention.MCP_ERROR_MESSAGE = 'mcp.error.message';
SemanticConvention.MCP_ERROR_DATA = 'mcp.error.data';
// MCP tool attributes
SemanticConvention.MCP_TOOL_NAME = 'mcp.tool.name';
SemanticConvention.MCP_TOOL_DESCRIPTION = 'mcp.tool.description';
SemanticConvention.MCP_TOOL_ARGUMENTS = 'mcp.tool.arguments';
SemanticConvention.MCP_TOOL_RESULT = 'mcp.tool.result';
// MCP resource attributes
SemanticConvention.MCP_RESOURCE_URI = 'mcp.resource.uri';
SemanticConvention.MCP_RESOURCE_NAME = 'mcp.resource.name';
SemanticConvention.MCP_RESOURCE_DESCRIPTION = 'mcp.resource.description';
SemanticConvention.MCP_RESOURCE_MIME_TYPE = 'mcp.resource.mime_type';
SemanticConvention.MCP_RESOURCE_SIZE = 'mcp.resource.size';
// MCP transport attributes
SemanticConvention.MCP_TRANSPORT_TYPE = 'mcp.transport.type';
SemanticConvention.MCP_TRANSPORT_STDIO = 'stdio';
SemanticConvention.MCP_TRANSPORT_SSE = 'sse';
SemanticConvention.MCP_TRANSPORT_WEBSOCKET = 'websocket';
// MCP payload attributes
SemanticConvention.MCP_REQUEST_PAYLOAD = 'mcp.request.payload';
SemanticConvention.MCP_RESPONSE_PAYLOAD = 'mcp.response.payload';
// MCP client/server attributes
SemanticConvention.MCP_CLIENT_OPERATION_DURATION = 'mcp.client.operation.duration';
SemanticConvention.MCP_SERVER_NAME = 'mcp.server.name';
SemanticConvention.MCP_SERVER_VERSION = 'mcp.server.version';
SemanticConvention.MCP_CLIENT_VERSION = 'mcp.client.version';
SemanticConvention.MCP_CLIENT_TYPE = 'mcp.client.type';
SemanticConvention.MCP_RESPONSE_SIZE = 'mcp.response.size';
// MCP prompt attributes
SemanticConvention.MCP_PROMPT_NAME = 'mcp.prompt.name';
SemanticConvention.MCP_PROMPT_DESCRIPTION = 'mcp.prompt.description';
// MCP metric names
SemanticConvention.MCP_REQUESTS = 'mcp.requests';
SemanticConvention.MCP_CLIENT_OPERATION_DURATION_METRIC = 'mcp.client.operation.duration';
SemanticConvention.MCP_REQUEST_SIZE = 'mcp.request.size';
SemanticConvention.MCP_RESPONSE_SIZE_METRIC = 'mcp.response.size';
SemanticConvention.MCP_TOOL_CALLS = 'mcp.tool.calls';
SemanticConvention.MCP_RESOURCE_READS = 'mcp.resource.reads';
SemanticConvention.MCP_PROMPT_GETS = 'mcp.prompt.gets';
SemanticConvention.MCP_TRANSPORT_USAGE = 'mcp.transport.usage';
SemanticConvention.MCP_ERRORS = 'mcp.errors';
SemanticConvention.MCP_OPERATION_SUCCESS_RATE = 'mcp.operation.success_rate';
// FastMCP framework attributes
SemanticConvention.MCP_FASTMCP_SERVER_DEBUG_MODE = 'mcp.fastmcp.server.debug_mode';
SemanticConvention.MCP_FASTMCP_SERVER_LOG_LEVEL = 'mcp.fastmcp.server.log_level';
SemanticConvention.MCP_FASTMCP_SERVER_HOST = 'mcp.fastmcp.server.host';
SemanticConvention.MCP_FASTMCP_SERVER_PORT = 'mcp.fastmcp.server.port';
SemanticConvention.MCP_FASTMCP_SERVER_TRANSPORT = 'mcp.fastmcp.server.transport';
SemanticConvention.MCP_FASTMCP_TOOL_ANNOTATIONS = 'mcp.fastmcp.tool.annotations';
SemanticConvention.MCP_FASTMCP_RESOURCE_MIME_TYPE = 'mcp.fastmcp.resource.mime_type';
SemanticConvention.MCP_FASTMCP_PROMPT_ARGUMENTS = 'mcp.fastmcp.prompt.arguments';
SemanticConvention.MCP_FASTMCP_TOOL_STRUCTURED_OUTPUT = 'mcp.fastmcp.tool.structured_output';
SemanticConvention.MCP_FASTMCP_SERVER_INSTRUCTIONS = 'mcp.fastmcp.server.instructions';
SemanticConvention.MCP_FASTMCP_SERVER_LIFESPAN = 'mcp.fastmcp.server.lifespan';
SemanticConvention.MCP_FASTMCP_MOUNT_PATH = 'mcp.fastmcp.mount_path';
SemanticConvention.MCP_FASTMCP_SSE_PATH = 'mcp.fastmcp.sse_path';
SemanticConvention.MCP_FASTMCP_MESSAGE_PATH = 'mcp.fastmcp.message_path';
SemanticConvention.MCP_FASTMCP_STREAMABLE_HTTP_PATH = 'mcp.fastmcp.streamable_http_path';
SemanticConvention.MCP_FASTMCP_JSON_RESPONSE = 'mcp.fastmcp.json_response';
SemanticConvention.MCP_FASTMCP_STATELESS_HTTP = 'mcp.fastmcp.stateless_http';
// MCP auth & security attributes
SemanticConvention.MCP_AUTH_CLIENT_ID = 'mcp.auth.client_id';
SemanticConvention.MCP_AUTH_SCOPES = 'mcp.auth.scopes';
SemanticConvention.MCP_AUTH_GRANT_TYPE = 'mcp.auth.grant_type';
SemanticConvention.MCP_AUTH_TOKEN_TYPE = 'mcp.auth.token_type';
SemanticConvention.MCP_AUTH_EXPIRES_AT = 'mcp.auth.expires_at';
SemanticConvention.MCP_AUTH_AUTHORIZATION_CODE = 'mcp.auth.authorization_code';
SemanticConvention.MCP_AUTH_REDIRECT_URI = 'mcp.auth.redirect_uri';
SemanticConvention.MCP_AUTH_STATE = 'mcp.auth.state';
SemanticConvention.MCP_AUTH_CODE_CHALLENGE = 'mcp.auth.code_challenge';
SemanticConvention.MCP_AUTH_RESOURCE_INDICATOR = 'mcp.auth.resource_indicator';
SemanticConvention.MCP_SECURITY_TRANSPORT_SECURITY = 'mcp.security.transport_security';
// MCP session attributes
SemanticConvention.MCP_SESSION_READ_TIMEOUT = 'mcp.session.read_timeout';
SemanticConvention.MCP_SESSION_REQUEST_TIMEOUT = 'mcp.session.request_timeout';
SemanticConvention.MCP_SESSION_SAMPLING_SUPPORT = 'mcp.session.sampling_support';
SemanticConvention.MCP_SESSION_ELICITATION_SUPPORT = 'mcp.session.elicitation_support';
SemanticConvention.MCP_SESSION_ROOTS_SUPPORT = 'mcp.session.roots_support';
SemanticConvention.MCP_SESSION_CLIENT_INFO_NAME = 'mcp.session.client_info.name';
SemanticConvention.MCP_SESSION_CLIENT_INFO_VERSION = 'mcp.session.client_info.version';
SemanticConvention.MCP_SESSION_STATELESS = 'mcp.session.stateless';
SemanticConvention.MCP_SESSION_RAISE_EXCEPTIONS = 'mcp.session.raise_exceptions';
SemanticConvention.MCP_SESSION_PROGRESS_TOKEN = 'mcp.session.progress_token';
// MCP websocket attributes
SemanticConvention.MCP_WEBSOCKET_URL = 'mcp.websocket.url';
SemanticConvention.MCP_WEBSOCKET_SUBPROTOCOL = 'mcp.websocket.subprotocol';
// MCP performance attributes
SemanticConvention.MCP_TOOL_EXECUTION_TIME = 'mcp.tool.execution_time';
SemanticConvention.MCP_RESOURCE_READ_TIME = 'mcp.resource.read_time';
SemanticConvention.MCP_PROMPT_RENDER_TIME = 'mcp.prompt.render_time';
SemanticConvention.MCP_TRANSPORT_CONNECTION_TIME = 'mcp.transport.connection_time';
// MCP progress attributes
SemanticConvention.MCP_PROGRESS_COMPLETION_PERCENTAGE = 'mcp.progress.completion_percentage';
SemanticConvention.MCP_PROGRESS_TOTAL = 'mcp.progress.total';
SemanticConvention.MCP_PROGRESS_MESSAGE = 'mcp.progress.message';
SemanticConvention.MCP_PROGRESS_CONTEXT_CURRENT = 'mcp.progress.context.current';
SemanticConvention.MCP_PROGRESS_CONTEXT_TOTAL = 'mcp.progress.context.total';
// MCP sampling attributes
SemanticConvention.MCP_SAMPLING_MAX_TOKENS = 'mcp.sampling.max_tokens';
SemanticConvention.MCP_SAMPLING_MESSAGES = 'mcp.sampling.messages';
// MCP elicitation attributes
SemanticConvention.MCP_ELICITATION_ACTION = 'mcp.elicitation.action';
// MCP manager attributes
SemanticConvention.MCP_MANAGER_TYPE = 'mcp.manager.type';
SemanticConvention.MCP_TOOL_MANAGER_TOOL_COUNT = 'mcp.tool_manager.tool_count';
SemanticConvention.MCP_TOOL_MANAGER_WARN_DUPLICATES = 'mcp.tool_manager.warn_duplicates';
SemanticConvention.MCP_RESOURCE_MANAGER_RESOURCE_COUNT = 'mcp.resource_manager.resource_count';
SemanticConvention.MCP_RESOURCE_MANAGER_WARN_DUPLICATES = 'mcp.resource_manager.warn_duplicates';
SemanticConvention.MCP_PROMPT_MANAGER_PROMPT_COUNT = 'mcp.prompt_manager.prompt_count';
SemanticConvention.MCP_PROMPT_MANAGER_WARN_DUPLICATES = 'mcp.prompt_manager.warn_duplicates';
// MCP memory attributes
SemanticConvention.MCP_MEMORY_TRANSPORT_TYPE = 'mcp.memory.transport_type';
SemanticConvention.MCP_MEMORY_CLIENT_SERVER_SESSION = 'mcp.memory.client_server_session';
// MCP completion attributes
SemanticConvention.MCP_COMPLETION_REF_TYPE = 'mcp.completion.ref_type';
SemanticConvention.MCP_COMPLETION_ARGUMENT_NAME = 'mcp.completion.argument_name';
SemanticConvention.MCP_COMPLETION_ARGUMENT_VALUE = 'mcp.completion.argument_value';
SemanticConvention.MCP_COMPLETION_CONTEXT_ARGUMENTS = 'mcp.completion.context_arguments';
SemanticConvention.MCP_COMPLETION_VALUES = 'mcp.completion.values';
SemanticConvention.MCP_COMPLETION_TOTAL = 'mcp.completion.total';
SemanticConvention.MCP_COMPLETION_HAS_MORE = 'mcp.completion.has_more';
// MCP logging and notification attributes
SemanticConvention.MCP_LOGGING_LEVEL_SET = 'mcp.logging.level_set';
SemanticConvention.MCP_NOTIFICATION_TYPE = 'mcp.notification.type';
SemanticConvention.MCP_NOTIFICATION_RELATED_REQUEST_ID = 'mcp.notification.related_request_id';
SemanticConvention.MCP_PING_RESPONSE_TIME = 'mcp.ping.response_time';
SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT = 'create_agent';
// Graph attributes (LangGraph)
SemanticConvention.GEN_AI_GRAPH_NODES = 'gen_ai.graph.nodes';
SemanticConvention.GEN_AI_GRAPH_NODE_COUNT = 'gen_ai.graph.node_count';
SemanticConvention.GEN_AI_GRAPH_EDGES = 'gen_ai.graph.edges';
SemanticConvention.GEN_AI_GRAPH_EDGE_COUNT = 'gen_ai.graph.edge_count';
SemanticConvention.GEN_AI_GRAPH_EXECUTED_NODES = 'gen_ai.graph.executed_nodes';
SemanticConvention.GEN_AI_GRAPH_STATUS = 'gen_ai.graph.status';
SemanticConvention.GEN_AI_GRAPH_MESSAGE_COUNT = 'gen_ai.graph.message_count';
SemanticConvention.GEN_AI_GRAPH_TOTAL_CHUNKS = 'gen_ai.graph.total_chunks';
// Execution attributes (LangGraph)
SemanticConvention.GEN_AI_EXECUTION_MODE = 'gen_ai.execution.mode';
SemanticConvention.GEN_AI_CHECKPOINT_ID = 'gen_ai.checkpoint.id';
// Vector DB
SemanticConvention.DB_REQUESTS = 'db.total.requests';
SemanticConvention.DB_SYSTEM = 'db.system';
SemanticConvention.DB_SYSTEM_NAME = 'db.system.name';
SemanticConvention.DB_SYSTEM_CHROMA = 'chroma';
SemanticConvention.DB_SYSTEM_PINECONE = 'pinecone';
SemanticConvention.DB_SYSTEM_QDRANT = 'qdrant';
SemanticConvention.DB_SYSTEM_MILVUS = 'milvus';
SemanticConvention.DB_SYSTEM_ASTRA = 'astra';
SemanticConvention.DB_COLLECTION_NAME = 'db.collection.name';
SemanticConvention.DB_OPERATION = 'db.operation';
SemanticConvention.DB_OPERATION_NAME = 'db.operation.name';
SemanticConvention.DB_OPERATION_CREATE_INDEX = 'create_index';
SemanticConvention.DB_OPERATION_INSERT = 'INSERT';
SemanticConvention.DB_OPERATION_QUERY = 'QUERY';
SemanticConvention.DB_OPERATION_DELETE = 'DELETE';
SemanticConvention.DB_OPERATION_UPDATE = 'UPDATE';
SemanticConvention.DB_OPERATION_UPSERT = 'UPSERT';
SemanticConvention.DB_OPERATION_GET = 'GET';
SemanticConvention.DB_OPERATION_ADD = 'ADD';
SemanticConvention.DB_OPERATION_PEEK = 'PEEK';
SemanticConvention.DB_OPERATION_SEARCH = 'SEARCH';
SemanticConvention.DB_OPERATION_FETCH = 'FETCH';
SemanticConvention.DB_OPERATION_CREATE_COLLECTION = 'create_collection';
SemanticConvention.DB_OPERATION_DELETE_COLLECTION = 'delete_collection';
SemanticConvention.DB_OPERATION_SELECT = 'SELECT';
SemanticConvention.DB_OPERATION_REPLACE = 'findAndModify';
SemanticConvention.DB_OPERATION_FIND_AND_DELETE = 'findAndDelete';
SemanticConvention.DB_ID_COUNT = 'db.ids_count';
SemanticConvention.DB_VECTOR_COUNT = 'db.vector.count';
SemanticConvention.DB_METADATA_COUNT = 'db.metadatas_count';
SemanticConvention.DB_DOCUMENTS_COUNT = 'db.documents_count';
SemanticConvention.DB_QUERY_LIMIT = 'db.limit';
SemanticConvention.DB_VECTOR_QUERY_TOP_K = 'db.vector.query.top_k';
SemanticConvention.DB_OFFSET = 'db.offset';
SemanticConvention.DB_WHERE_DOCUMENT = 'db.where_document';
SemanticConvention.DB_FILTER = 'db.filter';
SemanticConvention.DB_QUERY_TEXT = 'db.query.text';
SemanticConvention.DB_QUERY_SUMMARY = 'db.query.summary';
SemanticConvention.DB_STATEMENT = 'db.statement';
SemanticConvention.DB_N_RESULTS = 'db.n_results';
SemanticConvention.DB_RESPONSE_RETURNED_ROWS = 'db.response.returned_rows';
SemanticConvention.DB_DELETE_ALL = 'db.delete_all';
SemanticConvention.DB_INDEX_NAME = 'db.create_index.name';
SemanticConvention.DB_INDEX_DIMENSION = 'db.create_index.dimensions';
SemanticConvention.DB_INDEX_METRIC = 'db.create_index.metric';
SemanticConvention.DB_INDEX_SPEC = 'db.create_index.spec';
SemanticConvention.DB_NAMESPACE = 'db.query.namespace';
SemanticConvention.DB_UPDATE_METADATA = 'db.update.metadata';
SemanticConvention.DB_UPDATE_VALUES = 'db.update.values';
SemanticConvention.DB_UPDATE_ID = 'db.update.id';
SemanticConvention.DB_CLIENT_OPERATION_DURATION = 'db.client.operation.duration';
// Vector DB extras (aligned with Python SDK / OTel)
SemanticConvention.DB_QUERY_PARAMETER = 'db.query.parameter';
SemanticConvention.DB_SDK_VERSION = 'db.sdk.version';
SemanticConvention.DB_OPERATION_ID = 'db.operation.id';
SemanticConvention.DB_OPERATION_STATUS = 'db.operation.status';
SemanticConvention.DB_OPERATION_COST = 'db.operation.cost';
SemanticConvention.DB_INDEX_NAME_ALT = 'db.index.name';
SemanticConvention.DB_COLLECTION_DIMENSION = 'db.collection.dimension';
SemanticConvention.DB_VECTOR_QUERY_FILTER = 'db.vector.query.filter';
SemanticConvention.DB_DELETE_ID = 'db.delete.id';
SemanticConvention.DB_METADATA = 'db.metadata';
SemanticConvention.DB_PAYLOAD_COUNT = 'db.payload_count';
SemanticConvention.DB_WITH_PAYLOAD = 'db.with_payload';
SemanticConvention.DB_OUTPUT_FIELDS = 'db.output_fields';
// ----- Mem0 (memory layer) instrumentation -----
// Session scope (mirrors Python semcov; stamped on memory spans when present)
SemanticConvention.GEN_AI_USER_ID = 'gen_ai.user.id';
SemanticConvention.GEN_AI_RUN_ID = 'gen_ai.run.id';
// Memory operation attributes
SemanticConvention.GEN_AI_MEMORY_TYPE = 'gen_ai.memory.type';
SemanticConvention.GEN_AI_MEMORY_METADATA = 'gen_ai.memory.metadata';
SemanticConvention.GEN_AI_MEMORY_INFER = 'gen_ai.memory.infer';
SemanticConvention.GEN_AI_MEMORY_COUNT = 'gen_ai.memory.count';
SemanticConvention.GEN_AI_MEMORY_SEARCH_QUERY = 'gen_ai.memory.search.query';
SemanticConvention.GEN_AI_MEMORY_SEARCH_LIMIT = 'gen_ai.memory.search.limit';
SemanticConvention.GEN_AI_MEMORY_SEARCH_THRESHOLD = 'gen_ai.memory.search.threshold';
SemanticConvention.GEN_AI_MEMORY_OPERATION_RESULT_COUNT = 'gen_ai.memory.operation.result_count';
// ----- Guard System -----
SemanticConvention.GUARD_REQUESTS = 'guard.requests';
SemanticConvention.GUARD_VERDICT = 'guard.verdict';
SemanticConvention.GUARD_SCORE = 'guard.score';
SemanticConvention.GUARD_CLASSIFICATION = 'guard.classification';
SemanticConvention.GUARD_VALIDATOR = 'guard.validator';
SemanticConvention.GUARD_EXPLANATION = 'guard.explanation';
// Guard events (new guard system)
SemanticConvention.GUARD_EVALUATION_EVENT = 'guard.evaluation';
SemanticConvention.GUARD_NAME = 'guard.name';
SemanticConvention.GUARD_PHASE = 'guard.phase';
SemanticConvention.GUARD_ACTION = 'guard.action';
SemanticConvention.GUARD_LATENCY_MS = 'guard.latency_ms';
SemanticConvention.GUARD_DENIED = 'guard.denied';
SemanticConvention.GUARD_REQUESTS_COUNTER = 'guard.requests';
// GenAI Evaluation Event (OTel Semantic Convention)
SemanticConvention.GEN_AI_EVALUATION_RESULT = 'gen_ai.evaluation.result';
SemanticConvention.GEN_AI_EVALUATION_NAME = 'gen_ai.evaluation.name';
SemanticConvention.GEN_AI_EVALUATION_SCORE_VALUE = 'gen_ai.evaluation.score.value';
SemanticConvention.GEN_AI_EVALUATION_SCORE_LABEL = 'gen_ai.evaluation.score.label';
SemanticConvention.GEN_AI_EVALUATION_EXPLANATION = 'gen_ai.evaluation.explanation';
SemanticConvention.OPENLIT_SCORE_IDEMPOTENCY_KEY = 'openlit.score.idempotency_key';
exports.default = SemanticConvention;
//# sourceMappingURL=semantic-convention.js.map