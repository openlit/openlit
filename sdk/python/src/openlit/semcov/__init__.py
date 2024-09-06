# pylint: disable=too-few-public-methods
"""
This module defines the `SemanticConvetion` class which encapsulates various constants used
for semantic tagging within a generalized AI application context. These constants are
intended for use across different components of AI applications, including request handling,
response processing, usage metrics, and interaction with vector databases and AI systems.
The purpose is to standardize the semantics for easier integration, analytics, and maintenance.
"""
class SemanticConvetion:
    """
    The SemanticConvetion class provides a centralized repository of constant values that
    represent the keys for various semantic conventions within AI applications. These
    conventions cover a broad range of areas including general AI configurations, request
    parameters, usage metrics, response attributes, and integrations with external AI and
    database systems. It is designed to facilitate consistency and understandability across
    the application's data logging and processing functionalities.
    """

    # GenAI General
    GEN_AI_ENDPOINT = "gen_ai.endpoint"
    GEN_AI_SYSTEM = "gen_ai.system"
    GEN_AI_ENVIRONMENT = "gen_ai.environment"
    GEN_AI_APPLICATION_NAME = "gen_ai.application_name"
    GEN_AI_TYPE = "gen_ai.operation.name"
    GEN_AI_HUB_OWNER = "gen_ai.hub.owner"
    GEN_AI_HUB_REPO = "gen_ai.hub.repo"
    GEN_AI_RETRIEVAL_SOURCE = "gen_ai.retrieval.source"
    GEN_AI_REQUESTS = "gen_ai.total.requests"
    GEN_AI_DATA_SOURCES = "gen_ai.data_source_count"

    # GenAI Request
    GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
    GEN_AI_REQUEST_TEMPERATURE = "gen_ai.request.temperature"
    GEN_AI_REQUEST_TOP_P = "gen_ai.request.top_p"
    GEN_AI_REQUEST_TOP_K = "gen_ai.request.top_k"
    GEN_AI_REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
    GEN_AI_REQUEST_IS_STREAM = "gen_ai.request.is_stream"
    GEN_AI_REQUEST_USER = "gen_ai.request.user"
    GEN_AI_REQUEST_SEED = "gen_ai.request.seed"
    GEN_AI_REQUEST_FREQUENCY_PENALTY = "gen_ai.request.frequency_penalty"
    GEN_AI_REQUEST_PRESENCE_PENALTY = "gen_ai.request.presence_penalty"
    GEN_AI_REQUEST_EMBEDDING_FORMAT = "gen_ai.request.embedding_format"
    GEN_AI_REQUEST_EMBEDDING_DIMENSION = "gen_ai.request.embedding_dimension"
    GEN_AI_REQUEST_TOOL_CHOICE = "gen_ai.request.tool_choice"
    GEN_AI_REQUEST_AUDIO_VOICE = "gen_ai.request.audio_voice"
    GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT = "gen_ai.request.audio_response_format"
    GEN_AI_REQUEST_AUDIO_SPEED = "gen_ai.request.audio_speed"
    GEN_AI_REQUEST_AUDIO_SETTINGS = "gen_ai.request.audio_settings"
    GEN_AI_REQUEST_FINETUNE_STATUS = "gen_ai.request.fine_tune_status"
    GEN_AI_REQUEST_FINETUNE_MODEL_SUFFIX = "gen_ai.request.fine_tune_model_suffix"
    GEN_AI_REQUEST_FINETUNE_MODEL_EPOCHS = "gen_ai.request.fine_tune_n_epochs"
    GEN_AI_REQUEST_FINETUNE_MODEL_LRM = "gen_ai.request.learning_rate_multiplier"
    GEN_AI_REQUEST_FINETUNE_BATCH_SIZE = "gen_ai.request.fine_tune_batch_size"
    GEN_AI_REQUEST_VALIDATION_FILE = "gen_ai.request.validation_file"
    GEN_AI_REQUEST_TRAINING_FILE = "gen_ai.request.training_file"

    GEN_AI_REQUEST_IMAGE_SIZE = "gen_ai.request.image_size"
    GEN_AI_REQUEST_IMAGE_QUALITY = "gen_ai.request.image_quality"
    GEN_AI_REQUEST_IMAGE_STYLE = "gen_ai.request.image_style"

    # GenAI Usage
    GEN_AI_USAGE_PROMPT_TOKENS = "gen_ai.usage.input_tokens"
    GEN_AI_USAGE_COMPLETION_TOKENS = "gen_ai.usage.output_tokens"
    GEN_AI_USAGE_TOTAL_TOKENS = "gen_ai.usage.total_tokens"
    GEN_AI_USAGE_COST = "gen_ai.usage.cost"

    # GenAI Response
    GEN_AI_RESPONSE_ID = "gen_ai.response.id"
    GEN_AI_RESPONSE_FINISH_REASON = "gen_ai.response.finish_reasons"
    GEN_AI_RESPONSE_IMAGE = "gen_ai.response.image"  # Not used directly in code yet

    # GenAI Content
    GEN_AI_CONTENT_PROMPT_EVENT = "gen_ai.content.prompt"
    GEN_AI_CONTENT_PROMPT = "gen_ai.prompt"
    GEN_AI_CONTENT_COMPLETION_EVENT = "gen_ai.content.completion"
    GEN_AI_CONTENT_COMPLETION = "gen_ai.completion"
    GEN_AI_CONTENT_REVISED_PROMPT = "gen_ai.content.revised_prompt"

    # GenAI Evaluation Metrics
    GEN_AI_EVAL_CONTEXT_RELEVANCY = "gen_ai.eval.context_relevancy"
    GEN_AI_EVAL_ANSWER_RELEVANCY = "gen_ai.eval.answer_relevancy"
    GEN_AI_EVAL_GROUNDEDNESS = "gen_ai.eval.groundedness"

    GEN_AI_TYPE_CHAT = "chat"
    GEN_AI_TYPE_EMBEDDING = "embedding"
    GEN_AI_TYPE_IMAGE = "image"
    GEN_AI_TYPE_AUDIO = "audio"
    GEN_AI_TYPE_FINETUNING = "fine_tuning"
    GEN_AI_TYPE_VECTORDB = "vectordb"
    GEN_AI_TYPE_FRAMEWORK = "framework"

    GEN_AI_SYSTEM_HUGGING_FACE = "huggingface"
    GEN_AI_SYSTEM_OPENAI = "openai"
    GEN_AI_SYSTEM_AZURE_OPENAI = "azure_openai"
    GEN_AI_SYSTEM_ANTHROPIC = "anthropic"
    GEN_AI_SYSTEM_COHERE = "cohere"
    GEN_AI_SYSTEM_MISTRAL = "mistral"
    GEN_AI_SYSTEM_BEDROCK = "bedrock"
    GEN_AI_SYSTEM_VERTEXAI = "vertex_ai"
    GEN_AI_SYSTEM_GROQ = "groq"
    GEN_AI_SYSTEM_OLLAMA = "ollama"
    GEN_AI_SYSTEM_GPT4ALL = "gpt4all"
    GEN_AI_SYSTEM_ELEVENLABS = "elevenlabs"
    GEN_AI_SYSTEM_VLLM = "vLLM"
    GEN_AI_SYSTEM_GOOGLE_AI_STUDIO = "google-ai-studio"
    GEN_AI_SYSTEM_AZURE_AI_INFERENCE = "azure-ai-inference"
    GEN_AI_SYSTEM_LANGCHAIN = "langchain"
    GEN_AI_SYSTEM_LLAMAINDEX = "llama_index"
    GEN_AI_SYSTEM_HAYSTACK = "haystack"
    GEN_AI_SYSTEM_EMBEDCHAIN = "embedchain"

    # Vector DB
    DB_REQUESTS = "db.total.requests"
    DB_SYSTEM = "db.system"
    DB_COLLECTION_NAME = "db.collection.name"
    DB_OPERATION = "db.operation"
    DB_OPERATION_STATUS = "db.operation.status"
    DB_OPERATION_COST = "db.operation.cost"
    DB_OPERATION_CREATE_INDEX = "create_index"
    DB_OPERATION_CREATE_COLLECTION = "create_collection"
    DB_OPERATION_UPDATE_COLLECTION = "update_collection"
    DB_OPERATION_DELETE_COLLECTION = "delete_collection"
    DB_OPERATION_QUERY = "query"
    DB_OPERATION_DELETE = "delete"
    DB_OPERATION_UPDATE = "update"
    DB_OPERATION_UPSERT = "upsert"
    DB_OPERATION_GET = "get"
    DB_OPERATION_ADD = "add"
    DB_OPERATION_PEEK = "peek"
    DB_ID_COUNT = "db.ids_count"
    DB_VECTOR_COUNT = "db.vector_count"
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

    DB_SYSTEM_CHROMA = "chroma"
    DB_SYSTEM_PINECONE = "pinecone"
    DB_SYSTEM_QDRANT = "qdrant"
    DB_SYSTEM_MILVUS = "milvus"

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
