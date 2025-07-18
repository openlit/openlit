# pylint: disable=too-few-public-methods
"""
This module defines the `SemanticConvention` class which encapsulates various constants used
for semantic tagging within a generalized AI application context. These constants are
intended for use across different components of AI applications, including request handling,
response processing, usage metrics, and interaction with vector databases and AI systems.
The purpose is to standardize the semantics for easier integration, analytics, and maintenance.
"""


class SemanticConvention:
    """
    The SemanticConvention class provides a centralized repository of constant values that
    represent the keys for various semantic conventions within AI applications. These
    conventions cover a broad range of areas including general AI configurations, request
    parameters, usage metrics, response attributes, and integrations with external AI and
    database systems. It is designed to facilitate consistency and understandability across
    the application's data logging and processing functionalities.
    """

    # General Attributes (OTel Semconv)
    SERVER_PORT = "server.port"
    SERVER_ADDRESS = "server.address"
    ERROR_TYPE = "error.type"

    # GenAI Metric Names (OTel Semconv)
    GEN_AI_CLIENT_TOKEN_USAGE = "gen_ai.client.token.usage"
    DB_CLIENT_TOKEN_USAGE = "db.client.token.usage"
    GEN_AI_CLIENT_OPERATION_DURATION = "gen_ai.client.operation.duration"
    GEN_AI_SERVER_REQUEST_DURATION = "gen_ai.server.request.duration"
    GEN_AI_SERVER_TBT = "gen_ai.server.time_per_output_token"
    GEN_AI_SERVER_TTFT = "gen_ai.server.time_to_first_token"

    # GenAI Event Names (OTel Semconv)
    GEN_AI_USER_MESSAGE = "gen_ai.user.message"
    GEN_AI_SYSTEM_MESSAGE = "gen_ai.system.message"
    GEN_AI_ASSISTANT_MESSAGE = "gen_ai.assistant.message"
    GEN_AI_TOOL_MESSAGE = "gen_ai.tools.message"
    GEN_AI_CHOICE = "gen_ai.choice"

    # GenAI Request Attributes (OTel Semconv)
    GEN_AI_OPERATION = "gen_ai.operation.name"
    GEN_AI_SYSTEM = "gen_ai.system"
    GEN_AI_OUTPUT_TYPE = "gen_ai.output.type"
    GEN_AI_ENDPOINT = "gen_ai.endpoint"
    GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
    GEN_AI_REQUEST_SEED = "gen_ai.request.seed"
    GEN_AI_REQUEST_ENCODING_FORMATS = "gen_ai.request.encoding_formats"
    GEN_AI_REQUEST_FREQUENCY_PENALTY = "gen_ai.request.frequency_penalty"
    GEN_AI_REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
    GEN_AI_REQUEST_PRESENCE_PENALTY = "gen_ai.request.presence_penalty"
    GEN_AI_REQUEST_STOP_SEQUENCES = "gen_ai.request.stop_sequences"
    GEN_AI_REQUEST_TEMPERATURE = "gen_ai.request.temperature"
    GEN_AI_REQUEST_TOP_K = "gen_ai.request.top_k"
    GEN_AI_REQUEST_TOP_P = "gen_ai.request.top_p"

    # GenAI Response Attributes (OTel Semconv)
    GEN_AI_TOKEN_TYPE = "gen_ai.token.type"
    GEN_AI_RESPONSE_FINISH_REASON = "gen_ai.response.finish_reasons"
    GEN_AI_RESPONSE_ID = "gen_ai.response.id"
    GEN_AI_RESPONSE_MODEL = "gen_ai.response.model"

    GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
    GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
    GEN_AI_USAGE_REASONING_TOKENS = "gen_ai.usage.reasoning_tokens"
    GEN_AI_USAGE_READ_UNITS = "gen_ai.usage.read_units"
    GEN_AI_USAGE_RERANK_UNITS = "gen_ai.usage.rerank_units"
    GEN_AI_TOOL_CALL_ID = "gen_ai.tool.call.id"
    GEN_AI_TOOL_NAME = "gen_ai.tool.name"
    GEN_AI_TOOL_ARGS = "gen_ai.tool.args"

    # GenAI Operation Types (OTel Semconv)
    GEN_AI_OPERATION_TYPE_CHAT = "chat"
    GEN_AI_OPERATION_TYPE_TOOLS = "execute_tool"
    GEN_AI_OPERATION_TYPE_EMBEDDING = "embeddings"
    GEN_AI_OPERATION_TYPE_IMAGE = "image"
    GEN_AI_OPERATION_TYPE_AUDIO = "audio"
    GEN_AI_OPERATION_TYPE_VECTORDB = "vectordb"
    GEN_AI_OPERATION_TYPE_FRAMEWORK = "workflow"
    GEN_AI_OPERATION_TYPE_AGENT = "invoke_agent"
    GEN_AI_OPERATION_TYPE_CREATE_AGENT = "create_agent"
    GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK = "execute_task"
    GEN_AI_OPERATION_TYPE_GRAPH_EXECUTION = "graph_execution"
    GEN_AI_OPERATION_TYPE_USER_PROMPT_PROCESSING = "user_prompt_processing"
    GEN_AI_OPERATION_TYPE_MODEL_REQUEST = "model_request"
    GEN_AI_OPERATION_TYPE_TOOL_COORDINATION = "tool_coordination"

    # Model Request Types
    GEN_AI_MODEL_REQUEST_TYPE_INITIAL = "initial"
    GEN_AI_MODEL_REQUEST_TYPE_TOOL_RESPONSE = "tool_response"
    GEN_AI_MODEL_REQUEST_TYPE_CHAT = "chat"

    # Tool Processing Types
    GEN_AI_TOOL_PROCESSING_TYPE_EXECUTION = "execution"
    GEN_AI_TOOL_PROCESSING_TYPE_COORDINATION = "coordination"
    GEN_AI_OPERATION_TYPE_RETRIEVE = "retrieve"

    # GenAI Output Types (OTel Semconv)
    GEN_AI_OUTPUT_TYPE_IMAGE = "image"
    GEN_AI_OUTPUT_TYPE_JSON = "json"
    GEN_AI_OUTPUT_TYPE_SPEECH = "speech"
    GEN_AI_OUTPUT_TYPE_TEXT = "text"

    # GenAI System Names (OTel Semconv)
    GEN_AI_SYSTEM_ANTHROPIC = "anthropic"
    GEN_AI_SYSTEM_AWS_BEDROCK = "aws.bedrock"
    GEN_AI_SYSTEM_AZURE_AI_INFERENCE = "az.ai.inference"
    GEN_AI_SYSTEM_AZURE_OPENAI = "az.ai.openai"
    GEN_AI_SYSTEM_COHERE = "cohere"
    GEN_AI_SYSTEM_DEEPSEEK = "deepseek"
    GEN_AI_SYSTEM_GEMINI = "gemini"
    GEN_AI_SYSTEM_GROQ = "groq"
    GEN_AI_SYSTEM_IBM_WATSON = "ibm.watson.ai"
    GEN_AI_SYSTEM_MISTRAL = "mistral_ai"
    GEN_AI_SYSTEM_OPENAI = "openai"
    GEN_AI_SYSTEM_PERPLEXITY = "perplexity"
    GEN_AI_SYSTEM_VERTEXAI = "vertex_ai"
    GEN_AI_SYSTEM_XAI = "xai"

    # GenAI OpenAI Attributes (OTel Semconv)
    GEN_AI_REQUEST_SERVICE_TIER = "gen_ai.request.service_tier"
    GEN_AI_RESPONSE_SERVICE_TIER = "gen_ai.response.service_tier"
    GEN_AI_RESPONSE_SYSTEM_FINGERPRINT = "gen_ai.response.system_fingerprint"

    # GenAI System Names (Extra)
    GEN_AI_SYSTEM_HUGGING_FACE = "huggingface"
    GEN_AI_SYSTEM_OLLAMA = "ollama"
    GEN_AI_SYSTEM_GPT4ALL = "gpt4all"
    GEN_AI_SYSTEM_ELEVENLABS = "elevenlabs"
    GEN_AI_SYSTEM_VLLM = "vLLM"
    GEN_AI_SYSTEM_GOOGLE_AI_STUDIO = "google.ai.studio"
    GEN_AI_SYSTEM_REKAAI = "rekaai"
    GEN_AI_SYSTEM_PREMAI = "premai"
    GEN_AI_SYSTEM_LANGCHAIN = "langchain"
    GEN_AI_SYSTEM_LLAMAINDEX = "llama_index"
    GEN_AI_SYSTEM_HAYSTACK = "haystack"
    GEN_AI_SYSTEM_EMBEDCHAIN = "embedchain"
    GEN_AI_SYSTEM_MEM0 = "mem0"
    GEN_AI_SYSTEM_LITELLM = "litellm"
    GEN_AI_SYSTEM_CREWAI = "crewai"
    GEN_AI_SYSTEM_AG2 = "ag2"
    GEN_AI_SYSTEM_MULTION = "multion"
    GEN_AI_SYSTEM_DYNAMIQ = "dynamiq"
    GEN_AI_SYSTEM_PHIDATA = "phidata"
    GEN_AI_SYSTEM_JULEP = "julep"
    GEN_AI_SYSTEM_AI21 = "ai21"
    GEN_AI_SYSTEM_CONTROLFLOW = "controlflow"
    GEN_AI_SYSTEM_ASSEMBLYAI = "assemblyai"
    GEN_AI_SYSTEM_CRAWL4AI = "crawl4ai"
    GEN_AI_SYSTEM_FIRECRAWL = "firecrawl"
    GEN_AI_SYSTEM_LETTA = "letta"
    GEN_AI_SYSTEM_TOGETHER = "together"
    GEN_AI_SYSTEM_OPENAI_AGENTS = "openai_agents"
    GEN_AI_SYSTEM_PYDANTIC_AI = "pydantic_ai"

    # GenAI Framework Component Attributes (Standard)
    GEN_AI_FRAMEWORK_COMPONENT_NAME = "gen_ai.framework.component.name"
    GEN_AI_FRAMEWORK_COMPONENT_TYPE = "gen_ai.framework.component.type"
    GEN_AI_FRAMEWORK_COMPONENT_CLASS_NAME = "gen_ai.component.class_name"
    GEN_AI_FRAMEWORK_COMPONENT_INPUT_TYPES = "gen_ai.framework.component.input_types"
    GEN_AI_FRAMEWORK_COMPONENT_OUTPUT_TYPES = "gen_ai.framework.component.output_types"
    GEN_AI_FRAMEWORK_COMPONENT_INPUT_SPEC = "gen_ai.framework.component.input_spec"
    GEN_AI_FRAMEWORK_COMPONENT_OUTPUT_SPEC = "gen_ai.framework.component.output_spec"
    GEN_AI_FRAMEWORK_COMPONENT_VISITS = "gen_ai.framework.component.visits"
    GEN_AI_FRAMEWORK_COMPONENT_SENDERS = "gen_ai.framework.component.senders"
    GEN_AI_FRAMEWORK_COMPONENT_RECEIVERS = "gen_ai.framework.component.receivers"
    GEN_AI_FRAMEWORK_COMPONENT_CONNECTIONS = "gen_ai.framework.component.connections"

    # GenAI Framework Pipeline Attributes (Standard)
    GEN_AI_FRAMEWORK_PIPELINE_INPUT_DATA = "gen_ai.framework.pipeline.input_data"
    GEN_AI_FRAMEWORK_PIPELINE_OUTPUT_DATA = "gen_ai.framework.pipeline.output_data"
    GEN_AI_FRAMEWORK_PIPELINE_METADATA = "gen_ai.framework.pipeline.metadata"
    GEN_AI_FRAMEWORK_PIPELINE_MAX_RUNS = (
        "gen_ai.framework.pipeline.max_runs_per_component"
    )
    GEN_AI_FRAMEWORK_PIPELINE_COMPONENT_COUNT = (
        "gen_ai.framework.pipeline.component_count"
    )
    GEN_AI_FRAMEWORK_PIPELINE_EXECUTION_TIME = (
        "gen_ai.framework.pipeline.execution_time"
    )

    # GenAI Request Attributes (Extra)
    GEN_AI_REQUEST_IS_STREAM = "gen_ai.request.is_stream"
    GEN_AI_REQUEST_USER = "gen_ai.request.user"
    GEN_AI_REQUEST_EMBEDDING_DIMENSION = "gen_ai.request.embedding_dimension"
    GEN_AI_REQUEST_TOOL_CHOICE = "gen_ai.request.tool_choice"
    GEN_AI_REQUEST_AUDIO_VOICE = "gen_ai.request.audio_voice"
    GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT = "gen_ai.request.audio_response_format"
    GEN_AI_REQUEST_AUDIO_SPEED = "gen_ai.request.audio_speed"
    GEN_AI_REQUEST_AUDIO_SETTINGS = "gen_ai.request.audio_settings"
    GEN_AI_REQUEST_AUDIO_DURATION = "gen_ai.request.audio_duration"
    GEN_AI_REQUEST_IMAGE_SIZE = "gen_ai.request.image_size"
    GEN_AI_REQUEST_IMAGE_QUALITY = "gen_ai.request.image_quality"
    GEN_AI_REQUEST_IMAGE_STYLE = "gen_ai.request.image_style"
    GEN_AI_HUB_OWNER = "gen_ai.hub.owner"
    GEN_AI_HUB_REPO = "gen_ai.hub.repo"
    GEN_AI_RETRIEVAL_SOURCE = "gen_ai.retrieval.source"
    GEN_AI_REQUESTS = "gen_ai.total.requests"
    GEN_AI_DATA_SOURCES = "gen_ai.data_source_count"
    GEN_AI_ENVIRONMENT = "gen_ai.environment"
    GEN_AI_APPLICATION_NAME = "gen_ai.application_name"
    GEN_AI_SDK_VERSION = "gen_ai.sdk.version"

    # GenAI Response Attributes (Extra)
    GEN_AI_USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens"
    GEN_AI_USAGE_COST = "gen_ai.usage.cost"
    GEN_AI_RESPONSE_IMAGE = "gen_ai.response.image"
    GEN_AI_TOOL_CALLS = "gen_ai.response.tool_calls"

    # GenAI Content
    GEN_AI_CONTENT_PROMPT_EVENT = "gen_ai.content.prompt"
    GEN_AI_CONTENT_PROMPT = "gen_ai.prompt"
    GEN_AI_CONTENT_COMPLETION_EVENT = "gen_ai.content.completion"
    GEN_AI_CONTENT_COMPLETION = "gen_ai.completion"
    GEN_AI_CONTENT_REVISED_PROMPT = "gen_ai.content.revised_prompt"
    GEN_AI_CONTENT_REASONING = "gen_ai.content.reasoning"

    # GenAI Rag
    GEN_AI_RAG_MAX_SEGMENTS = "gen_ai.rag.max_segments"
    GEN_AI_RAG_STRATEGY = "gen_ai.rag.strategy"
    GEN_AI_RAG_SIMILARITY_THRESHOLD = "gen_ai.rag.similarity_threshold"
    GEN_AI_RAG_MAX_NEIGHBORS = "gen_ai.rag.max_neighbors"
    GEN_AI_RAG_DOCUMENTS_PATH = "gen_ai.rag.documents_path"
    GEN_AI_RAG_FILE_IDS = "gen_ai.rag.file_ids"

    # GenAI Evaluation Metrics
    GEN_AI_EVAL_CONTEXT_RELEVANCY = "gen_ai.eval.context_relevancy"
    GEN_AI_EVAL_ANSWER_RELEVANCY = "gen_ai.eval.answer_relevancy"
    GEN_AI_EVAL_GROUNDEDNESS = "gen_ai.eval.groundedness"

    # VectorDB Metrics (OTel Semconv)
    DB_CLIENT_OPERATION_DURATION = "db.client.operation.duration"

    # Vector DB Attributes (OTel Semconv)
    DB_SYSTEM_NAME = "db.system.name"
    DB_COLLECTION_NAME = "db.collection.name"
    DB_NAMESPACE = "db.namespace"
    DB_OPERATION_NAME = "db.operation.name"
    DB_QUERY_TEXT = "db.query.text"
    DB_QUERY_SUMMARY = "db.query.summary"
    DB_RESPONSE_RETURNED_ROWS = "db.response.returned_rows"

    # Vector DB Attributes (Extras)
    DB_SDK_VERSION = "db.sdk.version"
    DB_OPERATION_API_ENDPOINT = "db.operation.api_endpoint"
    DB_REQUESTS = "db.total.requests"
    DB_OPERATION_ID = "db.operation.id"
    DB_OPERATION_STATUS = "db.operation.status"
    DB_OPERATION_COST = "db.operation.cost"
    DB_OPERATION_CREATE_INDEX = "create_index"
    DB_OPERATION_GET_COLLECTION = "get_collection"
    DB_OPERATION_CREATE_COLLECTION = "create_collection"
    DB_OPERATION_UPDATE_COLLECTION = "update_collection"
    DB_OPERATION_DELETE_COLLECTION = "delete_collection"
    DB_OPERATION_INSERT = "INSERT"
    DB_OPERATION_SELECT = "SELECT"
    DB_OPERATION_QUERY = "QUERY"
    DB_OPERATION_SEARCH = "SEARCH"
    DB_OPERATION_FETCH = "FETCH"
    DB_OPERATION_REPLACE = "findAndModify"
    DB_OPERATION_FIND_AND_DELETE = "findAndDelete"
    DB_OPERATION_DELETE = "DELETE"
    DB_OPERATION_UPDATE = "UPDATE"
    DB_OPERATION_UPSERT = "UPSERT"
    DB_OPERATION_GET = "GET"
    DB_OPERATION_ADD = "ADD"
    DB_OPERATION_PEEK = "peePEEKk"
    DB_ID_COUNT = "db.ids_count"
    DB_VECTOR_COUNT = "db.vector.count"
    DB_METADATA = "db.metadata"
    DB_METADATA_COUNT = "db.metadatas_count"
    DB_DOCUMENTS_COUNT = "db.documents_count"
    DB_PAYLOAD_COUNT = "db.payload_count"
    DB_QUERY_LIMIT = "db.limit"
    DB_OFFSET = "db.offset"
    DB_WHERE_DOCUMENT = "db.where_document"
    DB_FILTER = "db.filter"
    DB_STATEMENT = "db.statement"
    DB_N_RESULTS = "db.n_results"
    DB_DELETE_ALL = "db.delete_all"
    DB_INDEX_NAME = "db.index.name"
    DB_COLLECTION_DIMENSION = "db.collection.dimension"
    DB_INDEX_DIMENSION = "db.index.dimension"
    DB_COLLECTION_DIMENSION = "db.collection.dimension"
    DB_SEARCH_SIMILARITY_METRIC = "db.search.similarity_metric"
    DB_INDEX_METRIC = "db.create_index.metric"
    DB_COLLECTION_SPEC = "db.collection.spec"
    DB_INDEX_SPEC = "db.create_index.spec"
    DB_NAMESPACE = "db.query.namespace"
    DB_UPDATE_METADATA = "db.update.metadata"
    DB_UPDATE_VALUES = "db.update.values"
    DB_UPDATE_ID = "db.update.id"
    DB_DELETE_ID = "db.delete.id"
    DB_VECTOR_QUERY_TOP_K = "db.vector.query.top_k"
    DB_VECTOR_QUERY_FILTER = "db.vector.query.filter"

    DB_SYSTEM_CHROMA = "chroma"
    DB_SYSTEM_PINECONE = "pinecone"
    DB_SYSTEM_QDRANT = "qdrant"
    DB_SYSTEM_MILVUS = "milvus"
    DB_SYSTEM_ASTRA = "astra"

    # GenAI Request Attributes (OTel Semconv)
    GEN_AI_AGENT_ID = "gen_ai.agent.id"
    GEN_AI_AGENT_NAME = "gen_ai.agent.name"
    GEN_AI_AGENT_DESCRIPTION = "gen_ai.agent.description"

    GEN_AI_AGENT_TYPE = "gen_ai.agent.type"
    GEN_AI_AGENT_TASK_ID = "gen_ai.agent.task.id"
    GEN_AI_AGENT_ROLE = "gen_ai.agent.role"
    GEN_AI_AGENT_GOAL = "gen_ai.agent.goal"
    GEN_AI_AGENT_CONTEXT = "gen_ai.agent.context"
    GEN_AI_AGENT_ENABLE_CACHE = "gen_ai.agent.enable_cache"
    GEN_AI_AGENT_ENABLE_HISTORY = "gen_ai.agent.enable_history"
    GEN_AI_AGENT_ALLOW_DELEGATION = "gen_ai.agent.allow_delegation"
    GEN_AI_AGENT_ALLOW_CODE_EXECUTION = "gen_ai.agent.allow_code_execution"
    GEN_AI_AGENT_MAX_RETRY_LIMIT = "gen_ai.agent.max_retry_limit"
    GEN_AI_AGENT_TOOLS = "gen_ai.agent.tools"
    GEN_AI_AGENT_TOOL_RESULTS = "gen_ai.agent.tool_results"
    GEN_AI_AGENT_TASK = "gen_ai.agent.task"
    GEN_AI_AGENT_PARAMS = "gen_ai.agent.params"
    GEN_AI_AGENT_INSTRUCTIONS = "gen_ai.agent.instructions"
    GEN_AI_AGENT_STORAGE = "gen_ai.agent.storage"
    GEN_AI_AGENT_EXPECTED_OUTPUT = "gen_ai.agent.expected_output"
    GEN_AI_AGENT_ACTUAL_OUTPUT = "gen_ai.agent.actual_output"
    GEN_AI_AGENT_HUMAN_INPUT = "gen_ai.agent.human_input"
    GEN_AI_AGENT_SCHEMA = "gen_ai.agent.schema"
    GEN_AI_AGENT_TASK_ASSOCIATION = "gen_ai.agent.task_associations"
    GEN_AI_AGENT_BROWSE_URL = "gen_ai.agent.browse_url"
    GEN_AI_AGENT_STEP_COUNT = "gen_ai.agent.step_count"
    GEN_AI_AGENT_RESPONSE_TIME = "gen_ai.agent.response_time"
    GEN_AI_AGENT_STRATEGY = "gen_ai.agent.strategy"

    GEN_AI_AGENT_TYPE_BROWSER = "browser"

    # GPU
    GPU_INDEX = "gpu.index"
    GPU_UUID = "gpu.uuid"
    GPU_NAME = "gpu.name"

    GPU_UTILIZATION = "gpu.utilization"
    GPU_UTILIZATION_ENC = "gpu.enc.utilization"
    GPU_UTILIZATION_DEC = "gpu.dec.utilization"
    GPU_TEMPERATURE = "gpu.temperature"
    GPU_FAN_SPEED = "gpu.fan_speed"
    GPU_MEMORY_AVAILABLE = "gpu.memory.available"
    GPU_MEMORY_TOTAL = "gpu.memory.total"
    GPU_MEMORY_USED = "gpu.memory.used"
    GPU_MEMORY_FREE = "gpu.memory.free"
    GPU_POWER_DRAW = "gpu.power.draw"
    GPU_POWER_LIMIT = "gpu.power.limit"

    # Guard
    GUARD_REQUESTS = "guard.requests"
    GUARD_VERDICT = "guard.verdict"
    GUARD_SCORE = "guard.score"
    GUARD_CLASSIFICATION = "guard.classification"
    GUARD_VALIDATOR = "guard.validator"
    GUARD_EXPLANATION = "guard.explanation"

    # Evals
    EVAL_REQUESTS = "evals.requests"
    EVAL_VERDICT = "evals.verdict"
    EVAL_SCORE = "evals.score"
    EVAL_CLASSIFICATION = "evals.classification"
    EVAL_VALIDATOR = "evals.validator"
    EVAL_EXPLANATION = "evals.explanation"

    # === FRAMEWORK OPERATIONS (Generic attributes for all RAG/AI frameworks) ===

    # Document Processing
    GEN_AI_FRAMEWORK_DOCUMENTS_COUNT = "gen_ai.framework.documents.count"
    GEN_AI_FRAMEWORK_DOCUMENT_SOURCES = "gen_ai.framework.document.sources"
    GEN_AI_FRAMEWORK_DOCUMENT_SIZE = "gen_ai.framework.document.size"
    GEN_AI_FRAMEWORK_DOCUMENT_TYPE = "gen_ai.framework.document.type"

    # Text Processing & Chunking
    GEN_AI_FRAMEWORK_CHUNK_SIZE = "gen_ai.framework.chunk.size"
    GEN_AI_FRAMEWORK_CHUNK_OVERLAP = "gen_ai.framework.chunk.overlap"
    GEN_AI_FRAMEWORK_CHUNK_COUNT = "gen_ai.framework.chunk.count"
    GEN_AI_FRAMEWORK_TEXT_LENGTH = "gen_ai.framework.text.length"
    GEN_AI_FRAMEWORK_TEXT_PROCESSED = "gen_ai.framework.text.processed"

    # Node/Data Processing
    GEN_AI_FRAMEWORK_NODES_COUNT = "gen_ai.framework.nodes.count"
    GEN_AI_FRAMEWORK_NODES_PROCESSED = "gen_ai.framework.nodes.processed"
    GEN_AI_FRAMEWORK_NODES_CREATED = "gen_ai.framework.nodes.created"
    GEN_AI_FRAMEWORK_NODES_ADDED = "gen_ai.framework.nodes.added"
    GEN_AI_FRAMEWORK_NODES_INSERTED = "gen_ai.framework.nodes.inserted"
    GEN_AI_FRAMEWORK_NODES_DELETED = "gen_ai.framework.nodes.deleted"
    GEN_AI_FRAMEWORK_NODE_ID = "gen_ai.framework.node.id"

    # Embedding Operations
    GEN_AI_FRAMEWORK_EMBEDDING_DIMENSION = "gen_ai.framework.embedding.dimension"
    GEN_AI_FRAMEWORK_EMBEDDING_COUNT = "gen_ai.framework.embedding.count"
    GEN_AI_FRAMEWORK_EMBEDDING_BATCH_SIZE = "gen_ai.framework.embedding.batch_size"
    GEN_AI_FRAMEWORK_EMBEDDING_MODEL = "gen_ai.framework.embedding.model"
    GEN_AI_FRAMEWORK_EMBEDDING_PROCESSED = "gen_ai.framework.embedding.processed"

    # Query Operations
    GEN_AI_FRAMEWORK_QUERY_TYPE = "gen_ai.framework.query.type"
    GEN_AI_FRAMEWORK_QUERY_TEXT = "gen_ai.framework.query.text"
    GEN_AI_FRAMEWORK_QUERY_LENGTH = "gen_ai.framework.query.length"
    GEN_AI_FRAMEWORK_SIMILARITY_TOP_K = "gen_ai.framework.similarity.top_k"
    GEN_AI_FRAMEWORK_SIMILARITY_THRESHOLD = "gen_ai.framework.similarity.threshold"

    # Retrieval Operations
    GEN_AI_FRAMEWORK_RETRIEVAL_SOURCE = "gen_ai.framework.retrieval.source"
    GEN_AI_FRAMEWORK_RETRIEVAL_COUNT = "gen_ai.framework.retrieval.count"
    GEN_AI_FRAMEWORK_RETRIEVAL_METHOD = "gen_ai.framework.retrieval.method"

    # Response Generation
    GEN_AI_FRAMEWORK_RESPONSE_LENGTH = "gen_ai.framework.response.length"
    GEN_AI_FRAMEWORK_TEMPLATE_TYPE = "gen_ai.framework.template.type"
    GEN_AI_FRAMEWORK_CONTEXT_SIZE = "gen_ai.framework.context.size"
    GEN_AI_FRAMEWORK_CONTEXT_COUNT = "gen_ai.framework.context.count"

    # Processing Flags & Configuration
    GEN_AI_FRAMEWORK_SHOW_PROGRESS = "gen_ai.framework.show_progress"

    # Vector Store Operations (reuse DB attributes where appropriate)
    GEN_AI_FRAMEWORK_VECTOR_DIMENSION = "gen_ai.framework.vector.dimension"
    GEN_AI_FRAMEWORK_INDEX_NAME = "gen_ai.framework.index.name"
    GEN_AI_FRAMEWORK_INDEX_TYPE = "gen_ai.framework.index.type"

    # === GENERAL FRAMEWORK SEMANTIC CONVENTIONS (reusable across frameworks) ===

    # Framework tracing attributes (general, reusable across frameworks)
    GEN_AI_FRAMEWORK_TAGS = "gen_ai.framework.tags"

    # Framework performance tracking (general)
    GEN_AI_FRAMEWORK_PERFORMANCE_VS_BASELINE = (
        "gen_ai.framework.performance.vs_baseline"
    )
    GEN_AI_FRAMEWORK_PERFORMANCE_BASELINE_AVG = (
        "gen_ai.framework.performance.baseline_avg"
    )
    GEN_AI_FRAMEWORK_PERFORMANCE_BASELINE_PERCENTILE = (
        "gen_ai.framework.performance.baseline_percentile"
    )

    # Framework error classification (general)
    GEN_AI_FRAMEWORK_ERROR_CLASS = "gen_ai.framework.error.class"
    GEN_AI_FRAMEWORK_ERROR_TYPE = "gen_ai.framework.error.type"
    GEN_AI_FRAMEWORK_ERROR_MESSAGE = "gen_ai.framework.error.message"

    # Workflow attributes (general, reusable)
    GEN_AI_WORKFLOW_TYPE = "gen_ai.workflow.type"
    GEN_AI_WORKFLOW_INPUT = "gen_ai.workflow.input"
    GEN_AI_WORKFLOW_OUTPUT = "gen_ai.workflow.output"

    # Serialized function information (general, reusable)
    GEN_AI_SERIALIZED_NAME = "gen_ai.serialized.name"
    GEN_AI_SERIALIZED_SIGNATURE = "gen_ai.serialized.signature"
    GEN_AI_SERIALIZED_DOC = "gen_ai.serialized.doc"
    GEN_AI_SERIALIZED_MODULE = "gen_ai.serialized.module"

    # Tool operation attributes (general, reusable)
    GEN_AI_TOOL_INPUT = "gen_ai.tool.input"
    GEN_AI_TOOL_OUTPUT = "gen_ai.tool.output"

    # Retrieval operation attributes (general, reusable)
    GEN_AI_RETRIEVAL_QUERY = "gen_ai.retrieval.query"
    GEN_AI_RETRIEVAL_DOCUMENT_COUNT = "gen_ai.retrieval.document_count"
    GEN_AI_RETRIEVAL_DOCUMENTS = "gen_ai.retrieval.documents"

    # Provider information (general, reusable)
    GEN_AI_REQUEST_PROVIDER = "gen_ai.request.provider"

    # Enhanced token details (general, reusable across providers)
    GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_AUDIO = (
        "gen_ai.usage.completion_tokens_details.audio"
    )
    GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_REASONING = (
        "gen_ai.usage.completion_tokens_details.reasoning"
    )
    GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_READ = (
        "gen_ai.usage.prompt_tokens_details.cache_read"
    )
    GEN_AI_USAGE_PROMPT_TOKENS_DETAILS_CACHE_WRITE = (
        "gen_ai.usage.prompt_tokens_details.cache_write"
    )

    # === STANDARD OPENTELEMETRY SEMANTIC CONVENTIONS ===
    # These are framework-agnostic and reusable across all agent frameworks

    # OpenAI Agent-specific Attributes (for any framework using OpenAI models)
    GEN_AI_CONVERSATION_ID = "gen_ai.conversation.id"
    GEN_AI_OPENAI_ASSISTANT_ID = "gen_ai.openai.assistant.id"
    GEN_AI_OPENAI_THREAD_ID = "gen_ai.openai.thread.id"
    GEN_AI_OPENAI_RUN_ID = "gen_ai.openai.run.id"
    GEN_AI_OPENAI_REQUEST_SERVICE_TIER = "gen_ai.openai.request.service_tier"
    GEN_AI_OPENAI_RESPONSE_SERVICE_TIER = "gen_ai.openai.response.service_tier"
    GEN_AI_OPENAI_RESPONSE_SYSTEM_FINGERPRINT = (
        "gen_ai.openai.response.system_fingerprint"
    )

    # Data Source Attributes (for RAG and knowledge retrieval)
    GEN_AI_DATA_SOURCE_ID = "gen_ai.data_source.id"
    GEN_AI_DATA_SOURCE_TYPE = "gen_ai.data_source.type"

    # Standard Tool Attributes (framework-agnostic)
    GEN_AI_TOOL_TYPE = "gen_ai.tool.type"

    # Standard Workflow Attributes (framework-agnostic)
    GEN_AI_WORKFLOW_AGENT_COUNT = "gen_ai.workflow.agent_count"
    GEN_AI_WORKFLOW_TASK_COUNT = "gen_ai.workflow.task_count"
    GEN_AI_WORKFLOW_EXECUTION_TYPE = "gen_ai.workflow.execution_type"

    # Standard Task Attributes (framework-agnostic)
    GEN_AI_TASK_DESCRIPTION = "gen_ai.task.description"
    GEN_AI_TASK_EXPECTED_OUTPUT = "gen_ai.task.expected_output"

    GEN_AI_GROUPCHAT_PARTICIPANTS = "gen_ai.groupchat.participants"
    GEN_AI_GROUPCHAT_SPEAKER_SELECTION = "gen_ai.groupchat.speaker_selection"
    GEN_AI_GROUPCHAT_MESSAGE_COUNT = "gen_ai.groupchat.message_count"
    GEN_AI_GROUPCHAT_TURN_COUNT = "gen_ai.groupchat.turn_count"

    GEN_AI_AGENT_RECIPIENT = "gen_ai.agent.recipient"
    GEN_AI_AGENT_SENDER = "gen_ai.agent.sender"
    GEN_AI_AGENT_MESSAGE_TYPE = "gen_ai.agent.message_type"
    GEN_AI_AGENT_REPLY_MODE = "gen_ai.agent.reply_mode"

    # === ENHANCED SEMANTIC CONVENTIONS FOR COMPREHENSIVE INSTRUMENTATION ===

    # Message structure attributes (reuse existing prompt for input, add output messages)
    # Note: For input messages, we reuse GEN_AI_CONTENT_PROMPT for consistency
    GEN_AI_OUTPUT_MESSAGES = "gen_ai.output_messages"
    GEN_AI_MESSAGE_ROLE = "gen_ai.message.role"
    GEN_AI_MESSAGE_CONTENT = "gen_ai.message.content"

    # Tool result tracking (extending existing tool attributes)
    GEN_AI_TOOL_RESULT = "gen_ai.tool.result"
    GEN_AI_TOOL_SCHEMA = "gen_ai.tool.schema"

    # Model invocation parameters (for comprehensive model tracking)
    GEN_AI_REQUEST_PARAMETERS = "gen_ai.request.parameters"

    # Session and conversation tracking
    GEN_AI_SESSION_ID = "gen_ai.session.id"
    GEN_AI_USER_ID = "gen_ai.user.id"

    # Agent lifecycle phases
    GEN_AI_AGENT_LIFECYCLE_PHASE = "gen_ai.agent.lifecycle.phase"
    GEN_AI_AGENT_LIFECYCLE_PHASE_CREATE = "create"
    GEN_AI_AGENT_LIFECYCLE_PHASE_EXECUTE = "execute"
    GEN_AI_AGENT_LIFECYCLE_PHASE_GRAPH_EXECUTION = "graph_execution"
    GEN_AI_AGENT_LIFECYCLE_PHASE_USER_PROMPT_PROCESSING = "user_prompt_processing"
    GEN_AI_AGENT_LIFECYCLE_PHASE_MODEL_REQUEST = "model_request"
    GEN_AI_AGENT_LIFECYCLE_PHASE_TOOL_EXECUTION = "tool_execution"

    # Performance metrics (extending existing cost tracking)
    GEN_AI_PERFORMANCE_TOKENS_PER_SECOND = "gen_ai.performance.tokens_per_second"
    # Note: For latency/duration, we reuse existing GEN_AI_CLIENT_OPERATION_DURATION

    # Tool execution metadata
    GEN_AI_TOOL_EXECUTION_DURATION = "gen_ai.tool.execution.duration"
    GEN_AI_TOOL_EXECUTION_SUCCESS = "gen_ai.tool.execution.success"
