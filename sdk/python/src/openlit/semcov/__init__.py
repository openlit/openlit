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
    GEN_AI_TOOL_CALL_ID = "gen_ai.tool.call.id"
    GEN_AI_TOOL_NAME = "gen_ai.tool.name"

    # GenAI Operation Types (OTel Semconv)
    GEN_AI_OPERATION_TYPE_CHAT = "chat"
    GEN_AI_OPERATION_TYPE_TOOLS = "execute_tool"
    GEN_AI_OPERATION_TYPE_EMBEDDING = "embeddings"
    GEN_AI_OPERATION_TYPE_IMAGE = "image"
    GEN_AI_OPERATION_TYPE_AUDIO = "audio"
    GEN_AI_OPERATION_TYPE_VECTORDB = "vectordb"
    GEN_AI_OPERATION_TYPE_FRAMEWORK = "framework"
    GEN_AI_OPERATION_TYPE_AGENT = "agent"
    GEN_AI_OPERATION_TYPE_CREATE_AGENT = "create_agent"
    GEN_AI_OPERATION_TYPE_EXECUTE_AGENT_TASK = "execute_task"

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
    DB_OPERATION_REPLACE = "findAndModify"
    DB_OPERATION_FIND_AND_DELETE = "findAndDelete"
    DB_OPERATION_DELETE = "DELETE"
    DB_OPERATION_UPDATE = "UPDATE"
    DB_OPERATION_UPSERT = "UPSERT"
    DB_OPERATION_GET = "GET"
    DB_OPERATION_ADD = "ADD"
    DB_OPERATION_PEEK = "peePEEKk"
    DB_ID_COUNT = "db.ids_count"
    DB_VECTOR_COUNT = "db.vector_count"
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
    DB_INDEX_DIMENSION = "db.index.dimension"
    DB_COLLECTION_DIMENSION = "db.collection.dimension"
    DB_INDEX_METRIC = "db.create_index.metric"
    DB_INDEX_SPEC = "db.create_index.spec"
    DB_NAMESPACE = "db.query.namespace"
    DB_UPDATE_METADATA = "db.update.metadata"
    DB_UPDATE_VALUES = "db.update.values"
    DB_UPDATE_ID = "db.update.id"
    DB_DELETE_ID = "db.delete.id"

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
