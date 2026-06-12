/**
 * Semantic conventions aligned with OpenTelemetry Gen AI spec and Python SDK.
 * Old keys are kept for backward compatibility; new OTel-aligned keys are added with _OTEL suffix.
 */
export default class SemanticConvention {
  // Unstable SemConv
  static ATTR_DEPLOYMENT_ENVIRONMENT = 'deployment.environment';

  // ----- GenAI General (legacy keys kept for backward compatibility) -----
  static GEN_AI_PROVIDER_NAME = 'gen_ai.system';
  /** OTel standard: use for new code / future compatibility */
  static GEN_AI_PROVIDER_NAME_OTEL = 'gen_ai.provider.name';

  // ----- OTel Gen AI & Server/Error (new keys; legacy below unchanged) -----
  static GEN_AI_OPERATION = 'gen_ai.operation.name';
  static GEN_AI_OUTPUT_TYPE = 'gen_ai.output.type';
  static GEN_AI_REQUEST_MODEL = 'gen_ai.request.model';
  static GEN_AI_REQUEST_SEED = 'gen_ai.request.seed';
  static GEN_AI_REQUEST_CHOICE_COUNT = 'gen_ai.request.choice.count';
  static GEN_AI_REQUEST_ENCODING_FORMATS = 'gen_ai.request.encoding_formats';
  static GEN_AI_REQUEST_FREQUENCY_PENALTY = 'gen_ai.request.frequency_penalty';
  static GEN_AI_REQUEST_MAX_TOKENS = 'gen_ai.request.max_tokens';
  static GEN_AI_REQUEST_PRESENCE_PENALTY = 'gen_ai.request.presence_penalty';
  static GEN_AI_REQUEST_STOP_SEQUENCES = 'gen_ai.request.stop_sequences';
  static GEN_AI_REQUEST_TEMPERATURE = 'gen_ai.request.temperature';
  static GEN_AI_REQUEST_TOP_K = 'gen_ai.request.top_k';
  static GEN_AI_REQUEST_TOP_P = 'gen_ai.request.top_p';
  static GEN_AI_CONVERSATION_ID = 'gen_ai.conversation.id';
  static GEN_AI_RESPONSE_FINISH_REASON = 'gen_ai.response.finish_reasons';
  static GEN_AI_RESPONSE_ID = 'gen_ai.response.id';
  static GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model';
  static GEN_AI_INPUT_MESSAGES = 'gen_ai.input.messages';
  static GEN_AI_OUTPUT_MESSAGES = 'gen_ai.output.messages';
  static GEN_AI_SYSTEM_INSTRUCTIONS = 'gen_ai.system_instructions';
  static GEN_AI_TOOL_DEFINITIONS = 'gen_ai.tool.definitions';
  static GEN_AI_EMBEDDINGS_DIMENSION_COUNT = 'gen_ai.embeddings.dimension.count';
  static GEN_AI_TOKEN_TYPE = 'gen_ai.token.type';
  static GEN_AI_TOKEN_TYPE_INPUT = 'input';
  static GEN_AI_TOKEN_TYPE_OUTPUT = 'output';
  static GEN_AI_TOKEN_TYPE_REASONING = 'reasoning';
  static GEN_AI_CLIENT_OPERATION_DURATION = 'gen_ai.client.operation.duration';
  static GEN_AI_CLIENT_OPERATION_TIME_TO_FIRST_CHUNK = 'gen_ai.client.operation.time_to_first_chunk';
  /** OTel standard span attribute for TTFT */
  static GEN_AI_RESPONSE_TIME_TO_FIRST_CHUNK = 'gen_ai.response.time_to_first_chunk';
  static GEN_AI_CLIENT_OPERATION_TIME_PER_OUTPUT_CHUNK = 'gen_ai.client.operation.time_per_output_chunk';
  static GEN_AI_CLIENT_TOKEN_USAGE = 'gen_ai.client.token.usage';
  static GEN_AI_SERVER_REQUEST_DURATION = 'gen_ai.server.request.duration';
  static GEN_AI_SERVER_TBT = 'gen_ai.server.time_per_output_token';
  static GEN_AI_SERVER_TTFT = 'gen_ai.server.time_to_first_token';
  static SERVER_ADDRESS = 'server.address';
  static SERVER_PORT = 'server.port';
  static ERROR_TYPE = 'error.type';
  static ERROR_TYPE_UNAVAILABLE = 'unavailable';
  static ERROR_TYPE_AUTHENTICATION = 'authentication';
  static ERROR_TYPE_TIMEOUT = 'timeout';
  static ERROR_TYPE_RATE_LIMITED = 'rate_limited';
  static ERROR_TYPE_PERMISSION = 'permission';
  static ERROR_TYPE_NOT_FOUND = 'not_found';
  static ERROR_TYPE_INVALID_REQUEST = 'invalid_request';
  static ERROR_TYPE_SERVER_ERROR = 'server_error';

  // GenAI event names (OTel)
  static GEN_AI_USER_MESSAGE = 'gen_ai.user.message';
  static GEN_AI_SYSTEM_MESSAGE = 'gen_ai.system.message';
  static GEN_AI_ASSISTANT_MESSAGE = 'gen_ai.assistant.message';
  static GEN_AI_TOOL_MESSAGE = 'gen_ai.tools.message';
  static GEN_AI_CHOICE = 'gen_ai.choice';
  static GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS = 'gen_ai.client.inference.operation.details';

  // ----- GenAI General (OpenLIT + OTel) -----
  static GEN_AI_ENDPOINT = 'gen_ai.endpoint';
  static GEN_AI_ENVIRONMENT = 'gen_ai.environment';
  static GEN_AI_APPLICATION_NAME = 'gen_ai.application_name';
  static GEN_AI_HUB_OWNER = 'gen_ai.hub.owner';
  static GEN_AI_HUB_REPO = 'gen_ai.hub.repo';
  static GEN_AI_RETRIEVAL_SOURCE = 'gen_ai.retrieval.source';
  static GEN_AI_REQUESTS = 'gen_ai.total.requests';
  static GEN_AI_SDK_VERSION = 'gen_ai.sdk.version';

  // GenAI Request (extended / OpenLIT)
  static GEN_AI_REQUEST_IS_STREAM = 'gen_ai.request.is_stream';
  /** OTel standard: gen_ai.request.stream (replaces gen_ai.request.is_stream) */
  static GEN_AI_REQUEST_STREAM = 'gen_ai.request.stream';
  static GEN_AI_REQUEST_USER = 'gen_ai.request.user';
  static GEN_AI_REQUEST_EMBEDDING_DIMENSION = 'gen_ai.request.embedding_dimension';
  static GEN_AI_REQUEST_TOOL_CHOICE = 'gen_ai.request.tool_choice';
  static GEN_AI_REQUEST_AUDIO_VOICE = 'gen_ai.request.audio_voice';
  static GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT = 'gen_ai.request.audio_response_format';
  static GEN_AI_REQUEST_AUDIO_SPEED = 'gen_ai.request.audio_speed';
  static GEN_AI_REQUEST_FINETUNE_STATUS = 'gen_ai.request.fine_tune_status';
  static GEN_AI_REQUEST_FINETUNE_MODEL_SUFFIX = 'gen_ai.request.fine_tune_model_suffix';
  static GEN_AI_REQUEST_FINETUNE_MODEL_EPOCHS = 'gen_ai.request.fine_tune_n_epochs';
  static GEN_AI_REQUEST_FINETUNE_MODEL_LRM = 'gen_ai.request.learning_rate_multiplier';
  static GEN_AI_REQUEST_FINETUNE_BATCH_SIZE = 'gen_ai.request.fine_tune_batch_size';
  static GEN_AI_REQUEST_VALIDATION_FILE = 'gen_ai.request.validation_file';
  static GEN_AI_REQUEST_TRAINING_FILE = 'gen_ai.request.training_file';

  static GEN_AI_REQUEST_IMAGE_SIZE = 'gen_ai.request.image_size';
  static GEN_AI_REQUEST_IMAGE_QUALITY = 'gen_ai.request.image_quality';
  static GEN_AI_REQUEST_IMAGE_STYLE = 'gen_ai.request.image_style';
  static GEN_AI_REQUEST_SAFE_PROMPT = 'gen_ai.request.safe_prompt';
  static GEN_AI_REQUEST_REASONING_EFFORT = 'gen_ai.request.reasoning_effort';

  /** Legacy key for reading duration from span attributes */
  static GEN_AI_DURATION_LEGACY = 'gen_ai.duration';

  // GenAI Usage
  static GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens';
  static GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens';
  static GEN_AI_USAGE_TOTAL_TOKENS = 'gen_ai.usage.total_tokens';
  static GEN_AI_USAGE_COST = 'gen_ai.usage.cost';
  static GEN_AI_USAGE_REASONING_TOKENS = 'gen_ai.usage.reasoning_tokens';
  
  // Enhanced token details (for prompt caching, audio tokens, etc.)
  static GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_AUDIO = 'gen_ai.usage.completion_tokens_details.audio';
  static GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_REASONING = 'gen_ai.usage.completion_tokens_details.reasoning';
  static GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_READ = 'gen_ai.usage.prompt_tokens_details.cache_read';
  static GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_WRITE = 'gen_ai.usage.prompt_tokens_details.cache_write';
  // OTel semconv standard cache token attribute names (aligned with Python SDK)
  static GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS = 'gen_ai.usage.cache_creation.input_tokens';
  static GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS = 'gen_ai.usage.cache_read.input_tokens';

  // GenAI Response (extended)
  static GEN_AI_RESPONSE_IMAGE = 'gen_ai.response.image';
  static GEN_AI_RESPONSE_IMAGE_SIZE = 'gen_ai.request.image_size';
  static GEN_AI_RESPONSE_IMAGE_QUALITY = 'gen_ai.request.image_quality';
  static GEN_AI_RESPONSE_IMAGE_STYLE = 'gen_ai.request.image_style';

  // OpenAI-specific attributes (openai.* namespace per OTel semconv)
  static OPENAI_REQUEST_SERVICE_TIER = 'openai.request.service_tier';
  static OPENAI_RESPONSE_SERVICE_TIER = 'openai.response.service_tier';
  static OPENAI_RESPONSE_SYSTEM_FINGERPRINT = 'openai.response.system_fingerprint';
  static OPENAI_API_TYPE = 'openai.api.type';

  /** @deprecated Use OPENAI_RESPONSE_SYSTEM_FINGERPRINT for OpenAI */
  static GEN_AI_RESPONSE_SYSTEM_FINGERPRINT = 'gen_ai.response.system_fingerprint';

  // GenAI Content
  static GEN_AI_CONTENT_PROMPT_EVENT = 'gen_ai.content.prompt';
  static GEN_AI_CONTENT_COMPLETION_EVENT = 'gen_ai.content.completion';
  static GEN_AI_CONTENT_REVISED_PROMPT = 'gen_ai.content.revised_prompt';
  static GEN_AI_CONTENT_REASONING = 'gen_ai.content.reasoning';

  // Tool attributes (legacy: gen_ai.tool.call.type; OTel: gen_ai.tool.type)
  static GEN_AI_TOOL_NAME = 'gen_ai.tool.name';
  static GEN_AI_TOOL_TYPE = 'gen_ai.tool.call.type';
  /** OTel standard */
  static GEN_AI_TOOL_TYPE_OTEL = 'gen_ai.tool.type';
  static GEN_AI_TOOL_DESCRIPTION = 'gen_ai.tool.description';
  static GEN_AI_TOOL_DEFINITION = 'gen_ai.tool.definition';
  static GEN_AI_TOOL_CALL_ID = 'gen_ai.tool.call.id';
  static GEN_AI_TOOL_CALL_ARGUMENTS = 'gen_ai.tool.call.arguments';
  static GEN_AI_TOOL_CALL_RESULT = 'gen_ai.tool.call.result';
  static GEN_AI_TOOL_INPUT = 'gen_ai.tool.input';
  static GEN_AI_TOOL_OUTPUT = 'gen_ai.tool.output';
  static GEN_AI_TOOL_ARGS = 'gen_ai.tool.args';

  // Retrieval (framework / RAG)
  static GEN_AI_RETRIEVAL_QUERY = 'gen_ai.retrieval.query';
  static GEN_AI_RETRIEVAL_QUERY_TEXT = 'gen_ai.retrieval.query.text';
  static GEN_AI_RETRIEVAL_DOCUMENTS = 'gen_ai.retrieval.documents';
  static GEN_AI_RETRIEVAL_DOCUMENT_COUNT = 'gen_ai.retrieval.document_count';
  static GEN_AI_DATA_SOURCE_ID = 'gen_ai.data_source.id';
  static GEN_AI_RAG_SIMILARITY_THRESHOLD = 'gen_ai.rag.similarity_threshold';
  static GEN_AI_RAG_DOCUMENTS_PATH = 'gen_ai.rag.documents_path';
  static GEN_AI_RAG_FILE_IDS = 'gen_ai.rag.file_ids';
  static GEN_AI_RAG_MAX_NEIGHBORS = 'gen_ai.rag.max_neighbors';
  static GEN_AI_RAG_MAX_SEGMENTS = 'gen_ai.rag.max_segments';
  static GEN_AI_RAG_STRATEGY = 'gen_ai.rag.strategy';

  // Agent (OTel Semconv)
  static GEN_AI_AGENT_NAME = 'gen_ai.agent.name';
  static GEN_AI_AGENT_ID = 'gen_ai.agent.id';
  static GEN_AI_AGENT_DESCRIPTION = 'gen_ai.agent.description';
  static GEN_AI_AGENT_VERSION = 'gen_ai.agent.version';
  // OpenLIT vendor extension: auto-computed canonical fingerprint over the
  // parts of an agent's definition that meaningfully change its behavior
  // (system prompt + tools + primary model + sampling config). Stamped on
  // every chat span/event so the server can group traffic by version.
  static OPENLIT_AGENT_VERSION_HASH = 'openlit.agent.version_hash';
  static GEN_AI_AGENT_SOURCE = 'gen_ai.agent.source';
  static GEN_AI_AGENT_ACTION_TOOL = 'gen_ai.agent.action.tool';
  static GEN_AI_AGENT_ACTION_TOOL_INPUT = 'gen_ai.agent.action.tool_input';
  static GEN_AI_AGENT_ACTION_LOG = 'gen_ai.agent.action.log';
  static GEN_AI_AGENT_FINISH_OUTPUT = 'gen_ai.agent.finish.output';
  static GEN_AI_AGENT_FINISH_LOG = 'gen_ai.agent.finish.log';

  // Workflow / framework
  static GEN_AI_WORKFLOW_INPUT = 'gen_ai.workflow.input';
  static GEN_AI_WORKFLOW_OUTPUT = 'gen_ai.workflow.output';
  static GEN_AI_WORKFLOW_TYPE = 'gen_ai.workflow.type';
  static GEN_AI_WORKFLOW_NAME = 'gen_ai.workflow.name';
  static GEN_AI_FRAMEWORK_ERROR_CLASS = 'gen_ai.framework.error.class';
  static GEN_AI_FRAMEWORK_ERROR_TYPE = 'gen_ai.framework.error.type';
  static GEN_AI_FRAMEWORK_ERROR_MESSAGE = 'gen_ai.framework.error.message';
  static GEN_AI_SERIALIZED_NAME = 'gen_ai.serialized.name';
  static GEN_AI_SERIALIZED_SIGNATURE = 'gen_ai.serialized.signature';
  static GEN_AI_SERIALIZED_DOC = 'gen_ai.serialized.doc';
  static GEN_AI_SERIALIZED_MODULE = 'gen_ai.serialized.module';
  static GEN_AI_REQUEST_PROVIDER = 'gen_ai.request.provider';
  static GEN_AI_DATA_SOURCES = 'gen_ai.data_source_count';

  static GEN_AI_OPERATION_TYPE_TEXT_COMPLETION = 'text_completion';
  static GEN_AI_OPERATION_TYPE_CHAT = 'chat';
  static GEN_AI_OPERATION_TYPE_EMBEDDING = 'embeddings';
  static GEN_AI_OPERATION_TYPE_IMAGE = 'image';
  static GEN_AI_OPERATION_TYPE_AUDIO = 'audio';
  static GEN_AI_OPERATION_TYPE_FINETUNING = 'fine_tuning';
  static GEN_AI_OPERATION_TYPE_VECTORDB = 'vectordb';
  static GEN_AI_OPERATION_TYPE_FRAMEWORK = 'invoke_workflow';
  static GEN_AI_OPERATION_TYPE_AGENT = 'invoke_agent';
  static GEN_AI_OPERATION_TYPE_TOOLS = 'execute_tool';
  static GEN_AI_OPERATION_TYPE_RETRIEVE = 'retrieval';
  
  // GenAI Output Types
  static GEN_AI_OUTPUT_TYPE_TEXT = 'text';
  static GEN_AI_OUTPUT_TYPE_JSON = 'json';
  static GEN_AI_OUTPUT_TYPE_IMAGE = 'image';
  static GEN_AI_OUTPUT_TYPE_SPEECH = 'speech';

  static GEN_AI_SYSTEM_HUGGING_FACE = 'huggingface';
  static GEN_AI_SYSTEM_REPLICATE = 'replicate';
  static GEN_AI_SYSTEM_OPENAI = 'openai';
  static GEN_AI_SYSTEM_AZURE_OPENAI = 'azure.ai.openai';
  static GEN_AI_SYSTEM_ANTHROPIC = 'anthropic';
  static GEN_AI_SYSTEM_COHERE = 'cohere';
  static GEN_AI_SYSTEM_MISTRAL = 'mistral_ai';
  static GEN_AI_SYSTEM_AWS_BEDROCK = 'aws.bedrock';
  static GEN_AI_SYSTEM_VERTEXAI = 'vertex_ai';
  static GEN_AI_SYSTEM_LANGCHAIN = 'langchain';
  static GEN_AI_SYSTEM_VERCEL_AI = 'vercel_ai';
  static GEN_AI_SYSTEM_OLLAMA = 'ollama';
  static GEN_AI_SYSTEM_GOOGLE_AI_STUDIO = 'gcp.gemini';
  static GEN_AI_SYSTEM_GROQ = 'groq';
  static GEN_AI_SYSTEM_AI21 = 'ai21';
  static GEN_AI_SYSTEM_DIGITALOCEAN = 'digitalocean';
  static GEN_AI_SYSTEM_AZURE_AI_INFERENCE = 'azure.ai.inference';
  static GEN_AI_SYSTEM_LLAMAINDEX = 'llamaindex';
  static GEN_AI_SYSTEM_TOGETHER = 'together';
  static GEN_AI_SYSTEM_LANGGRAPH = 'langgraph';
  static GEN_AI_SYSTEM_OPENAI_AGENTS = 'openai_agents';
  static GEN_AI_SYSTEM_MASTRA = 'mastra';
  static GEN_AI_SYSTEM_CLAUDE_AGENT_SDK = 'claude_agent_sdk';
  static GEN_AI_SYSTEM_GOOGLE_ADK = 'google_adk';
  static GEN_AI_SYSTEM_STRANDS = 'strands_agents';
  static GEN_AI_SYSTEM_CURSOR = 'cursor';
  static GEN_AI_SYSTEM_MCP = 'mcp';

  // ----- MCP (Model Context Protocol) -----
  // Operation types
  static GEN_AI_OPERATION_TYPE_MCP_TOOL_CALL = 'mcp_tool_call';
  static GEN_AI_OPERATION_TYPE_MCP_TOOL_LIST = 'mcp_tool_list';
  static GEN_AI_OPERATION_TYPE_MCP_RESOURCE_READ = 'mcp_resource_read';
  static GEN_AI_OPERATION_TYPE_MCP_RESOURCE_LIST = 'mcp_resource_list';
  static GEN_AI_OPERATION_TYPE_MCP_REQUEST = 'mcp_request';
  static GEN_AI_OPERATION_TYPE_MCP_RESPONSE = 'mcp_response';
  static GEN_AI_OPERATION_TYPE_MCP_SERVER = 'mcp_server';
  static GEN_AI_OPERATION_TYPE_MCP_CLIENT = 'mcp_client';

  // Core MCP attributes
  static MCP_OPERATION = 'mcp.operation.name';
  static MCP_SYSTEM = 'mcp.system';
  static MCP_SDK_VERSION = 'mcp.sdk.version';
  static MCP_METHOD = 'mcp.method';
  static MCP_MESSAGE_ID = 'mcp.message_id';
  static MCP_JSONRPC_VERSION = 'mcp.jsonrpc_version';
  static MCP_PARAMS = 'mcp.params';
  static MCP_RESULT = 'mcp.result';

  // MCP error attributes
  static MCP_ERROR_CODE = 'mcp.error.code';
  static MCP_ERROR_MESSAGE = 'mcp.error.message';
  static MCP_ERROR_DATA = 'mcp.error.data';

  // MCP tool attributes
  static MCP_TOOL_NAME = 'mcp.tool.name';
  static MCP_TOOL_DESCRIPTION = 'mcp.tool.description';
  static MCP_TOOL_ARGUMENTS = 'mcp.tool.arguments';
  static MCP_TOOL_RESULT = 'mcp.tool.result';

  // MCP resource attributes
  static MCP_RESOURCE_URI = 'mcp.resource.uri';
  static MCP_RESOURCE_NAME = 'mcp.resource.name';
  static MCP_RESOURCE_DESCRIPTION = 'mcp.resource.description';
  static MCP_RESOURCE_MIME_TYPE = 'mcp.resource.mime_type';
  static MCP_RESOURCE_SIZE = 'mcp.resource.size';

  // MCP transport attributes
  static MCP_TRANSPORT_TYPE = 'mcp.transport.type';
  static MCP_TRANSPORT_STDIO = 'stdio';
  static MCP_TRANSPORT_SSE = 'sse';
  static MCP_TRANSPORT_WEBSOCKET = 'websocket';

  // MCP payload attributes
  static MCP_REQUEST_PAYLOAD = 'mcp.request.payload';
  static MCP_RESPONSE_PAYLOAD = 'mcp.response.payload';

  // MCP client/server attributes
  static MCP_CLIENT_OPERATION_DURATION = 'mcp.client.operation.duration';
  static MCP_SERVER_NAME = 'mcp.server.name';
  static MCP_SERVER_VERSION = 'mcp.server.version';
  static MCP_CLIENT_VERSION = 'mcp.client.version';
  static MCP_CLIENT_TYPE = 'mcp.client.type';
  static MCP_RESPONSE_SIZE = 'mcp.response.size';

  // MCP prompt attributes
  static MCP_PROMPT_NAME = 'mcp.prompt.name';
  static MCP_PROMPT_DESCRIPTION = 'mcp.prompt.description';

  // MCP metric names
  static MCP_REQUESTS = 'mcp.requests';
  static MCP_CLIENT_OPERATION_DURATION_METRIC = 'mcp.client.operation.duration';
  static MCP_REQUEST_SIZE = 'mcp.request.size';
  static MCP_RESPONSE_SIZE_METRIC = 'mcp.response.size';
  static MCP_TOOL_CALLS = 'mcp.tool.calls';
  static MCP_RESOURCE_READS = 'mcp.resource.reads';
  static MCP_PROMPT_GETS = 'mcp.prompt.gets';
  static MCP_TRANSPORT_USAGE = 'mcp.transport.usage';
  static MCP_ERRORS = 'mcp.errors';
  static MCP_OPERATION_SUCCESS_RATE = 'mcp.operation.success_rate';

  // FastMCP framework attributes
  static MCP_FASTMCP_SERVER_DEBUG_MODE = 'mcp.fastmcp.server.debug_mode';
  static MCP_FASTMCP_SERVER_LOG_LEVEL = 'mcp.fastmcp.server.log_level';
  static MCP_FASTMCP_SERVER_HOST = 'mcp.fastmcp.server.host';
  static MCP_FASTMCP_SERVER_PORT = 'mcp.fastmcp.server.port';
  static MCP_FASTMCP_SERVER_TRANSPORT = 'mcp.fastmcp.server.transport';
  static MCP_FASTMCP_TOOL_ANNOTATIONS = 'mcp.fastmcp.tool.annotations';
  static MCP_FASTMCP_RESOURCE_MIME_TYPE = 'mcp.fastmcp.resource.mime_type';
  static MCP_FASTMCP_PROMPT_ARGUMENTS = 'mcp.fastmcp.prompt.arguments';
  static MCP_FASTMCP_TOOL_STRUCTURED_OUTPUT = 'mcp.fastmcp.tool.structured_output';
  static MCP_FASTMCP_SERVER_INSTRUCTIONS = 'mcp.fastmcp.server.instructions';
  static MCP_FASTMCP_SERVER_LIFESPAN = 'mcp.fastmcp.server.lifespan';
  static MCP_FASTMCP_MOUNT_PATH = 'mcp.fastmcp.mount_path';
  static MCP_FASTMCP_SSE_PATH = 'mcp.fastmcp.sse_path';
  static MCP_FASTMCP_MESSAGE_PATH = 'mcp.fastmcp.message_path';
  static MCP_FASTMCP_STREAMABLE_HTTP_PATH = 'mcp.fastmcp.streamable_http_path';
  static MCP_FASTMCP_JSON_RESPONSE = 'mcp.fastmcp.json_response';
  static MCP_FASTMCP_STATELESS_HTTP = 'mcp.fastmcp.stateless_http';

  // MCP auth & security attributes
  static MCP_AUTH_CLIENT_ID = 'mcp.auth.client_id';
  static MCP_AUTH_SCOPES = 'mcp.auth.scopes';
  static MCP_AUTH_GRANT_TYPE = 'mcp.auth.grant_type';
  static MCP_AUTH_TOKEN_TYPE = 'mcp.auth.token_type';
  static MCP_AUTH_EXPIRES_AT = 'mcp.auth.expires_at';
  static MCP_AUTH_AUTHORIZATION_CODE = 'mcp.auth.authorization_code';
  static MCP_AUTH_REDIRECT_URI = 'mcp.auth.redirect_uri';
  static MCP_AUTH_STATE = 'mcp.auth.state';
  static MCP_AUTH_CODE_CHALLENGE = 'mcp.auth.code_challenge';
  static MCP_AUTH_RESOURCE_INDICATOR = 'mcp.auth.resource_indicator';
  static MCP_SECURITY_TRANSPORT_SECURITY = 'mcp.security.transport_security';

  // MCP session attributes
  static MCP_SESSION_READ_TIMEOUT = 'mcp.session.read_timeout';
  static MCP_SESSION_REQUEST_TIMEOUT = 'mcp.session.request_timeout';
  static MCP_SESSION_SAMPLING_SUPPORT = 'mcp.session.sampling_support';
  static MCP_SESSION_ELICITATION_SUPPORT = 'mcp.session.elicitation_support';
  static MCP_SESSION_ROOTS_SUPPORT = 'mcp.session.roots_support';
  static MCP_SESSION_CLIENT_INFO_NAME = 'mcp.session.client_info.name';
  static MCP_SESSION_CLIENT_INFO_VERSION = 'mcp.session.client_info.version';
  static MCP_SESSION_STATELESS = 'mcp.session.stateless';
  static MCP_SESSION_RAISE_EXCEPTIONS = 'mcp.session.raise_exceptions';
  static MCP_SESSION_PROGRESS_TOKEN = 'mcp.session.progress_token';

  // MCP websocket attributes
  static MCP_WEBSOCKET_URL = 'mcp.websocket.url';
  static MCP_WEBSOCKET_SUBPROTOCOL = 'mcp.websocket.subprotocol';

  // MCP performance attributes
  static MCP_TOOL_EXECUTION_TIME = 'mcp.tool.execution_time';
  static MCP_RESOURCE_READ_TIME = 'mcp.resource.read_time';
  static MCP_PROMPT_RENDER_TIME = 'mcp.prompt.render_time';
  static MCP_TRANSPORT_CONNECTION_TIME = 'mcp.transport.connection_time';

  // MCP progress attributes
  static MCP_PROGRESS_COMPLETION_PERCENTAGE = 'mcp.progress.completion_percentage';
  static MCP_PROGRESS_TOTAL = 'mcp.progress.total';
  static MCP_PROGRESS_MESSAGE = 'mcp.progress.message';
  static MCP_PROGRESS_CONTEXT_CURRENT = 'mcp.progress.context.current';
  static MCP_PROGRESS_CONTEXT_TOTAL = 'mcp.progress.context.total';

  // MCP sampling attributes
  static MCP_SAMPLING_MAX_TOKENS = 'mcp.sampling.max_tokens';
  static MCP_SAMPLING_MESSAGES = 'mcp.sampling.messages';

  // MCP elicitation attributes
  static MCP_ELICITATION_ACTION = 'mcp.elicitation.action';

  // MCP manager attributes
  static MCP_MANAGER_TYPE = 'mcp.manager.type';
  static MCP_TOOL_MANAGER_TOOL_COUNT = 'mcp.tool_manager.tool_count';
  static MCP_TOOL_MANAGER_WARN_DUPLICATES = 'mcp.tool_manager.warn_duplicates';
  static MCP_RESOURCE_MANAGER_RESOURCE_COUNT = 'mcp.resource_manager.resource_count';
  static MCP_RESOURCE_MANAGER_WARN_DUPLICATES = 'mcp.resource_manager.warn_duplicates';
  static MCP_PROMPT_MANAGER_PROMPT_COUNT = 'mcp.prompt_manager.prompt_count';
  static MCP_PROMPT_MANAGER_WARN_DUPLICATES = 'mcp.prompt_manager.warn_duplicates';

  // MCP memory attributes
  static MCP_MEMORY_TRANSPORT_TYPE = 'mcp.memory.transport_type';
  static MCP_MEMORY_CLIENT_SERVER_SESSION = 'mcp.memory.client_server_session';

  // MCP completion attributes
  static MCP_COMPLETION_REF_TYPE = 'mcp.completion.ref_type';
  static MCP_COMPLETION_ARGUMENT_NAME = 'mcp.completion.argument_name';
  static MCP_COMPLETION_ARGUMENT_VALUE = 'mcp.completion.argument_value';
  static MCP_COMPLETION_CONTEXT_ARGUMENTS = 'mcp.completion.context_arguments';
  static MCP_COMPLETION_VALUES = 'mcp.completion.values';
  static MCP_COMPLETION_TOTAL = 'mcp.completion.total';
  static MCP_COMPLETION_HAS_MORE = 'mcp.completion.has_more';

  // MCP logging and notification attributes
  static MCP_LOGGING_LEVEL_SET = 'mcp.logging.level_set';
  static MCP_NOTIFICATION_TYPE = 'mcp.notification.type';
  static MCP_NOTIFICATION_RELATED_REQUEST_ID = 'mcp.notification.related_request_id';
  static MCP_PING_RESPONSE_TIME = 'mcp.ping.response_time';

  static GEN_AI_OPERATION_TYPE_CREATE_AGENT = 'create_agent';

  // Graph attributes (LangGraph)
  static GEN_AI_GRAPH_NODES = 'gen_ai.graph.nodes';
  static GEN_AI_GRAPH_NODE_COUNT = 'gen_ai.graph.node_count';
  static GEN_AI_GRAPH_EDGES = 'gen_ai.graph.edges';
  static GEN_AI_GRAPH_EDGE_COUNT = 'gen_ai.graph.edge_count';
  static GEN_AI_GRAPH_EXECUTED_NODES = 'gen_ai.graph.executed_nodes';
  static GEN_AI_GRAPH_STATUS = 'gen_ai.graph.status';
  static GEN_AI_GRAPH_MESSAGE_COUNT = 'gen_ai.graph.message_count';
  static GEN_AI_GRAPH_TOTAL_CHUNKS = 'gen_ai.graph.total_chunks';

  // Execution attributes (LangGraph)
  static GEN_AI_EXECUTION_MODE = 'gen_ai.execution.mode';
  static GEN_AI_CHECKPOINT_ID = 'gen_ai.checkpoint.id';

  // Vector DB
  static DB_REQUESTS = 'db.total.requests';
  static DB_SYSTEM = 'db.system';
  static DB_SYSTEM_NAME = 'db.system.name';
  static DB_SYSTEM_CHROMA = 'chroma';
  static DB_SYSTEM_PINECONE = 'pinecone';
  static DB_SYSTEM_QDRANT = 'qdrant';
  static DB_SYSTEM_MILVUS = 'milvus';
  static DB_SYSTEM_ASTRA = 'astra';
  static DB_COLLECTION_NAME = 'db.collection.name';
  static DB_OPERATION = 'db.operation';
  static DB_OPERATION_NAME = 'db.operation.name';
  static DB_OPERATION_CREATE_INDEX = 'create_index';
  static DB_OPERATION_INSERT = 'INSERT';
  static DB_OPERATION_QUERY = 'QUERY';
  static DB_OPERATION_DELETE = 'DELETE';
  static DB_OPERATION_UPDATE = 'UPDATE';
  static DB_OPERATION_UPSERT = 'UPSERT';
  static DB_OPERATION_GET = 'GET';
  static DB_OPERATION_ADD = 'ADD';
  static DB_OPERATION_PEEK = 'PEEK';
  static DB_OPERATION_SEARCH = 'SEARCH';
  static DB_OPERATION_FETCH = 'FETCH';
  static DB_OPERATION_CREATE_COLLECTION = 'create_collection';
  static DB_OPERATION_DELETE_COLLECTION = 'delete_collection';
  static DB_OPERATION_SELECT = 'SELECT';
  static DB_OPERATION_REPLACE = 'findAndModify';
  static DB_OPERATION_FIND_AND_DELETE = 'findAndDelete';
  static DB_ID_COUNT = 'db.ids_count';
  static DB_VECTOR_COUNT = 'db.vector.count';
  static DB_METADATA_COUNT = 'db.metadatas_count';
  static DB_DOCUMENTS_COUNT = 'db.documents_count';
  static DB_QUERY_LIMIT = 'db.limit';
  static DB_VECTOR_QUERY_TOP_K = 'db.vector.query.top_k';
  static DB_OFFSET = 'db.offset';
  static DB_WHERE_DOCUMENT = 'db.where_document';
  static DB_FILTER = 'db.filter';
  static DB_QUERY_TEXT = 'db.query.text';
  static DB_QUERY_SUMMARY = 'db.query.summary';
  static DB_STATEMENT = 'db.statement';
  static DB_N_RESULTS = 'db.n_results';
  static DB_RESPONSE_RETURNED_ROWS = 'db.response.returned_rows';
  static DB_DELETE_ALL = 'db.delete_all';
  static DB_INDEX_NAME = 'db.create_index.name';
  static DB_INDEX_DIMENSION = 'db.create_index.dimensions';
  static DB_INDEX_METRIC = 'db.create_index.metric';
  static DB_INDEX_SPEC = 'db.create_index.spec';
  static DB_NAMESPACE = 'db.query.namespace';
  static DB_UPDATE_METADATA = 'db.update.metadata';
  static DB_UPDATE_VALUES = 'db.update.values';
  static DB_UPDATE_ID = 'db.update.id';
  static DB_CLIENT_OPERATION_DURATION = 'db.client.operation.duration';
  // Vector DB extras (aligned with Python SDK / OTel)
  static DB_QUERY_PARAMETER = 'db.query.parameter';
  static DB_SDK_VERSION = 'db.sdk.version';
  static DB_OPERATION_ID = 'db.operation.id';
  static DB_OPERATION_STATUS = 'db.operation.status';
  static DB_OPERATION_COST = 'db.operation.cost';
  static DB_INDEX_NAME_ALT = 'db.index.name';
  static DB_COLLECTION_DIMENSION = 'db.collection.dimension';
  static DB_VECTOR_QUERY_FILTER = 'db.vector.query.filter';
  static DB_DELETE_ID = 'db.delete.id';
  static DB_METADATA = 'db.metadata';
  static DB_PAYLOAD_COUNT = 'db.payload_count';
  static DB_WITH_PAYLOAD = 'db.with_payload';
  static DB_OUTPUT_FIELDS = 'db.output_fields';

  // ----- Guard System -----
  static GUARD_REQUESTS = 'guard.requests';
  static GUARD_VERDICT = 'guard.verdict';
  static GUARD_SCORE = 'guard.score';
  static GUARD_CLASSIFICATION = 'guard.classification';
  static GUARD_VALIDATOR = 'guard.validator';
  static GUARD_EXPLANATION = 'guard.explanation';
  // Guard events (new guard system)
  static GUARD_EVALUATION_EVENT = 'guard.evaluation';
  static GUARD_NAME = 'guard.name';
  static GUARD_PHASE = 'guard.phase';
  static GUARD_ACTION = 'guard.action';
  static GUARD_LATENCY_MS = 'guard.latency_ms';
  static GUARD_DENIED = 'guard.denied';
  static GUARD_REQUESTS_COUNTER = 'guard.requests';
}
