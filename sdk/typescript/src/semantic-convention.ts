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
  /** Legacy */
  static GEN_AI_SYSTEM_INSTRUCTIONS = 'gen_ai.system.instructions';
  /** OTel standard */
  static GEN_AI_SYSTEM_INSTRUCTIONS_OTEL = 'gen_ai.system_instructions';
  static GEN_AI_TOOL_DEFINITIONS = 'gen_ai.tool.definitions';
  static GEN_AI_EMBEDDINGS_DIMENSION_COUNT = 'gen_ai.embeddings.dimension.count';
  static GEN_AI_TOKEN_TYPE = 'gen_ai.token.type';
  static GEN_AI_TOKEN_TYPE_INPUT = 'input';
  static GEN_AI_TOKEN_TYPE_OUTPUT = 'output';
  static GEN_AI_TOKEN_TYPE_REASONING = 'reasoning';
  static GEN_AI_CLIENT_OPERATION_DURATION = 'gen_ai.client.operation.duration';
  static GEN_AI_CLIENT_OPERATION_TIME_TO_FIRST_CHUNK = 'gen_ai.client.operation.time_to_first_chunk';
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
  static GEN_AI_REQUEST_SERVICE_TIER = 'gen_ai.request.service_tier';
  static GEN_AI_RESPONSE_SERVICE_TIER = 'gen_ai.response.service_tier';
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
  static GEN_AI_RETRIEVAL_DOCUMENTS = 'gen_ai.retrieval.documents';
  static GEN_AI_RETRIEVAL_DOCUMENT_COUNT = 'gen_ai.retrieval.document_count';

  // Workflow / framework
  static GEN_AI_WORKFLOW_INPUT = 'gen_ai.workflow.input';
  static GEN_AI_WORKFLOW_OUTPUT = 'gen_ai.workflow.output';
  static GEN_AI_WORKFLOW_TYPE = 'gen_ai.workflow.type';
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
  static GEN_AI_OPERATION_TYPE_FRAMEWORK = 'workflow';
  
  // GenAI Output Types
  static GEN_AI_OUTPUT_TYPE_TEXT = 'text';
  static GEN_AI_OUTPUT_TYPE_JSON = 'json';
  static GEN_AI_OUTPUT_TYPE_IMAGE = 'image';
  static GEN_AI_OUTPUT_TYPE_SPEECH = 'speech';

  static GEN_AI_SYSTEM_HUGGING_FACE = 'huggingface';
  static GEN_AI_SYSTEM_REPLICATE = 'replicate';
  static GEN_AI_SYSTEM_OPENAI = 'openai';
  static GEN_AI_SYSTEM_AZURE_OPENAI = 'az.ai.openai';
  static GEN_AI_SYSTEM_ANTHROPIC = 'anthropic';
  static GEN_AI_SYSTEM_COHERE = 'cohere';
  static GEN_AI_SYSTEM_MISTRAL = 'mistral_ai';
  static GEN_AI_SYSTEM_AWS_BEDROCK = 'aws.bedrock';
  static GEN_AI_SYSTEM_VERTEXAI = 'vertex_ai';
  static GEN_AI_SYSTEM_LANGCHAIN = 'langchain';
  static GEN_AI_SYSTEM_VERCEL_AI = 'vercel_ai';
  static GEN_AI_SYSTEM_LLAMAINDEX = 'llamaindex';

  // Vector DB
  static DB_REQUESTS = 'db.total.requests';
  static DB_SYSTEM = 'db.system';
  static DB_SYSTEM_NAME = 'db.system.name';
  static DB_SYSTEM_CHROMA = 'chroma';
  static DB_SYSTEM_PINECONE = 'pinecone';
  static DB_SYSTEM_QDRANT = 'qdrant';
  static DB_SYSTEM_MILVUS = 'milvus';
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
}
