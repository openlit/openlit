# pylint: disable=broad-exception-caught
"""
The __init__.py module for the openLIT package.
This module sets up the openLIT configuration and instrumentation for various
large language models (LLMs).
"""

from typing import Dict
import logging
from importlib.util import find_spec
from functools import wraps
from contextlib import contextmanager


# Import internal modules for setting up tracing and fetching pricing info.
from opentelemetry import trace as t
from opentelemetry.trace import SpanKind, Status, StatusCode, Span
from openlit.semcov import SemanticConvetion
from openlit.otel.tracing import setup_tracing
from openlit.otel.metrics import setup_meter
from openlit.__helpers import fetch_pricing_info


# Instrumentors for various large language models.
from openlit.instrumentation.openai import OpenAIInstrumentor
from openlit.instrumentation.anthropic import AnthropicInstrumentor
from openlit.instrumentation.cohere import CohereInstrumentor
from openlit.instrumentation.mistral import MistralInstrumentor
from openlit.instrumentation.bedrock import BedrockInstrumentor
from openlit.instrumentation.vertexai import VertexAIInstrumentor
from openlit.instrumentation.groq import GroqInstrumentor
from openlit.instrumentation.ollama import OllamaInstrumentor
from openlit.instrumentation.gpt4all import GPT4AllInstrumentor
from openlit.instrumentation.elevenlabs import ElevenLabsInstrumentor
from openlit.instrumentation.vllm import VLLMInstrumentor
from openlit.instrumentation.google_ai_studio import GoogleAIStudioInstrumentor
from openlit.instrumentation.azure_ai_inference import AzureAIInferenceInstrumentor
from openlit.instrumentation.langchain import LangChainInstrumentor
from openlit.instrumentation.llamaindex import LlamaIndexInstrumentor
from openlit.instrumentation.haystack import HaystackInstrumentor
from openlit.instrumentation.embedchain import EmbedChainInstrumentor
from openlit.instrumentation.chroma import ChromaInstrumentor
from openlit.instrumentation.pinecone import PineconeInstrumentor
from openlit.instrumentation.qdrant import QdrantInstrumentor
from openlit.instrumentation.milvus import MilvusInstrumentor
from openlit.instrumentation.transformers import TransformersInstrumentor
from openlit.instrumentation.gpu import NvidiaGPUInstrumentor

# Set up logging for error and information messages.
logger = logging.getLogger(__name__)


class OpenlitConfig:
    """
    A Singleton Configuration class for openLIT.

    This class maintains a single instance of configuration settings including
    environment details, application name, and tracing information throughout the openLIT package.

    Attributes:
        environment (str): Deployment environment of the application.
        application_name (str): Name of the application using openLIT.
        pricing_info (Dict[str, Any]): Pricing information.
        tracer (Optional[Any]): Tracer instance for OpenTelemetry.
        otlp_endpoint (Optional[str]): Endpoint for OTLP.
        otlp_headers (Optional[Dict[str, str]]): Headers for OTLP.
        disable_batch (bool): Flag to disable batch span processing in tracing.
        trace_content (bool): Flag to enable or disable tracing of content.
    """

    _instance = None

    def __new__(cls):
        """Ensures that only one instance of the configuration exists."""
        if cls._instance is None:
            cls._instance = super(OpenlitConfig, cls).__new__(cls)
            cls.reset_to_defaults()
        return cls._instance

    @classmethod
    def reset_to_defaults(cls):
        """Resets configuration to default values."""
        cls.environment = "default"
        cls.application_name = "default"
        cls.pricing_info = {}
        cls.tracer = None
        cls.metrics_dict = {}
        cls.otlp_endpoint = None
        cls.otlp_headers = None
        cls.disable_batch = False
        cls.trace_content = True
        cls.disable_metrics = False

    @classmethod
    def update_config(
        cls,
        environment,
        application_name,
        tracer,
        otlp_endpoint,
        otlp_headers,
        disable_batch,
        trace_content,
        metrics_dict,
        disable_metrics,
        pricing_json,
    ):
        """
        Updates the configuration based on provided parameters.

        Args:
            environment (str): Deployment environment.
            application_name (str): Application name.
            tracer: Tracer instance.
            meter: Metric Instance
            otlp_endpoint (str): OTLP endpoint.
            otlp_headers (Dict[str, str]): OTLP headers.
            disable_batch (bool): Disable batch span processing flag.
            trace_content (bool): Enable or disable content tracing.
            pricing_json(str): path or url to the pricing json file
        """
        cls.environment = environment
        cls.application_name = application_name
        cls.pricing_info = fetch_pricing_info(pricing_json)
        cls.tracer = tracer
        cls.metrics_dict = metrics_dict
        cls.otlp_endpoint = otlp_endpoint
        cls.otlp_headers = otlp_headers
        cls.disable_batch = disable_batch
        cls.trace_content = trace_content
        cls.disable_metrics = disable_metrics

def module_exists(module_name):
    """Check if nested modules exist, addressing the dot notation issue."""
    parts = module_name.split(".")
    for i in range(1, len(parts) + 1):
        if find_spec(".".join(parts[:i])) is None:
            return False
    return True

def instrument_if_available(
    instrumentor_name,
    instrumentor_instance,
    config,
    disabled_instrumentors,
    module_name_map,
):
    """Instruments the specified instrumentor if its library is available."""
    if instrumentor_name in disabled_instrumentors:
        logger.info("Instrumentor %s is disabled", instrumentor_name)
        return

    module_name = module_name_map.get(instrumentor_name)

    if not module_name:
        logger.error("No module mapping for %s", instrumentor_name)
        return

    try:
        if module_exists(module_name):
            instrumentor_instance.instrument(
                environment=config.environment,
                application_name=config.application_name,
                tracer=config.tracer,
                pricing_info=config.pricing_info,
                trace_content=config.trace_content,
                metrics_dict=config.metrics_dict,
                disable_metrics=config.disable_metrics,
            )
            logger.info("Instrumented %s", instrumentor_name)
        else:
            # pylint: disable=line-too-long
            logger.info("Library for %s (%s) not found. Skipping instrumentation", instrumentor_name, module_name)
    except Exception as e:
        logger.error("Failed to instrument %s: %s", instrumentor_name, e)


def init(environment="default", application_name="default", tracer=None, otlp_endpoint=None,
         otlp_headers=None, disable_batch=False, trace_content=True, disabled_instrumentors=None,
         meter=None, disable_metrics=False, pricing_json=None, collect_gpu_stats=False):
    """
    Initializes the openLIT configuration and setups tracing.

    This function sets up the openLIT environment with provided configurations
    and initializes instrumentors for tracing.

    Args:
        environment (str): Deployment environment.
        application_name (str): Application name.
        tracer: Tracer instance (Optional).
        meter: OpenTelemetry Metrics Instance (Optional).
        otlp_endpoint (str): OTLP endpoint for exporter (Optional).
        otlp_headers (Dict[str, str]): OTLP headers for exporter (Optional).
        disable_batch (bool): Flag to disable batch span processing (Optional).
        trace_content (bool): Flag to trace content (Optional).
        disabled_instrumentors (List[str]): Optional. List of instrumentor names to disable.
        disable_metrics (bool): Flag to disable metrics (Optional).
        pricing_json(str): File path or url to the pricing json (Optional).
        collect_gpu_stats (bool): Flag to enable or disable GPU metrics collection.
    """
    disabled_instrumentors = disabled_instrumentors if disabled_instrumentors else []
    logger.info("Starting openLIT initialization...")

    module_name_map = {
        "openai": "openai",
        "anthropic": "anthropic",
        "cohere": "cohere",
        "mistral": "mistralai",
        "bedrock": "boto3",
        "vertexai": "vertexai",
        "groq": "groq",
        "ollama": "ollama",
        "gpt4all": "gpt4all",
        "elevenlabs": "elevenlabs",
        "vllm": "vllm",
        "google-ai-studio": "google.generativeai",
        "azure-ai-inference": "azure.ai.inference",
        "langchain": "langchain",
        "llama_index": "llama_index",
        "haystack": "haystack",
        "embedchain": "embedchain",
        "chroma": "chromadb",
        "pinecone": "pinecone",
        "qdrant": "qdrant_client",
        "milvus": "pymilvus",
        "transformers": "transformers",
    }

    invalid_instrumentors = [
        name for name in disabled_instrumentors if name not in module_name_map
    ]
    for invalid_name in invalid_instrumentors:
        logger.warning("Invalid instrumentor name detected and ignored: '%s'", invalid_name)

    try:
        # Retrieve or create the single configuration instance.
        config = OpenlitConfig()

        # Setup tracing based on the provided or default configuration.
        tracer = setup_tracing(
            application_name=application_name,
            environment=environment,
            tracer=tracer,
            otlp_endpoint=otlp_endpoint,
            otlp_headers=otlp_headers,
            disable_batch=disable_batch,
        )

        if not tracer:
            logger.error("openLIT tracing setup failed. Tracing will not be available.")
            return

        # Setup meter and receive metrics_dict instead of meter.
        metrics_dict = setup_meter(
            application_name=application_name,
            environment=environment,
            meter=meter,
            otlp_endpoint=otlp_endpoint,
            otlp_headers=otlp_headers,
        )

        if not metrics_dict:
            logger.error("openLIT metrics setup failed. Metrics will not be available.")
            return

        # Update global configuration with the provided settings.
        config.update_config(
            environment,
            application_name,
            tracer,
            otlp_endpoint,
            otlp_headers,
            disable_batch,
            trace_content,
            metrics_dict,
            disable_metrics,
            pricing_json,
        )

        # Map instrumentor names to their instances
        instrumentor_instances = {
            "openai": OpenAIInstrumentor(),
            "anthropic": AnthropicInstrumentor(),
            "cohere": CohereInstrumentor(),
            "mistral": MistralInstrumentor(),
            "bedrock": BedrockInstrumentor(),
            "vertexai": VertexAIInstrumentor(),
            "groq": GroqInstrumentor(),
            "ollama": OllamaInstrumentor(),
            "gpt4all": GPT4AllInstrumentor(),
            "elevenlabs": ElevenLabsInstrumentor(),
            "vllm": VLLMInstrumentor(),
            "google-ai-studio": GoogleAIStudioInstrumentor(),
            "azure-ai-inference": AzureAIInferenceInstrumentor(),
            "langchain": LangChainInstrumentor(),
            "llama_index": LlamaIndexInstrumentor(),
            "haystack": HaystackInstrumentor(),
            "embedchain": EmbedChainInstrumentor(),
            "chroma": ChromaInstrumentor(),
            "pinecone": PineconeInstrumentor(),
            "qdrant": QdrantInstrumentor(),
            "milvus": MilvusInstrumentor(),
            "transformers": TransformersInstrumentor(),
        }

        # Initialize and instrument only the enabled instrumentors
        for name, instrumentor in instrumentor_instances.items():
            instrument_if_available(name, instrumentor, config,
            disabled_instrumentors, module_name_map)

        if not disable_metrics and collect_gpu_stats:
            NvidiaGPUInstrumentor().instrument(
                environment=config.environment,
                application_name=config.application_name,
            )
    except Exception as e:
        logger.error("Error during openLIT initialization: %s", e)


def trace(wrapped):
    """
    Generates a telemetry wrapper for messages to collect metrics.
    """

    @wraps(wrapped)
    def wrapper(*args, **kwargs):
        __trace = t.get_tracer_provider()
        with __trace.get_tracer(__name__).start_as_current_span(
            name=wrapped.__name__,
            kind=SpanKind.CLIENT,
        ) as span:
            try:
                response = wrapped(*args, **kwargs)
                span.set_attribute(
                    SemanticConvetion.GEN_AI_CONTENT_COMPLETION, response
                )
                span.set_status(Status(StatusCode.OK))

            except Exception as e:
                response = None
                span.record_exception(e)
                span.set_status(status=Status(StatusCode.ERROR), description=e)
                logging.error("Error in %s: %s", wrapped.__name__, e, exc_info=True)

            # Adding function arguments as metadata
            try:
                span.set_attribute("function.args", str(args))
                span.set_attribute("function.kwargs", str(kwargs))
                span.set_attribute(
                    SemanticConvetion.GEN_AI_APPLICATION_NAME,
                    OpenlitConfig.application_name,
                )
                span.set_attribute(
                    SemanticConvetion.GEN_AI_ENVIRONMENT, OpenlitConfig.environment
                )

            except Exception as meta_exception:
                logging.error(
                    "Failed to set metadata for %s: %s",
                    wrapped.__name__,
                    meta_exception,
                    exc_info=True,
                )

            return response

    return wrapper


class TracedSpan:
    """
    A wrapper class for an OpenTelemetry span that provides helper methods
    for setting result and metadata attributes on the span.

    Attributes:
        _span (Span): The underlying OpenTelemetry span.
    """

    def __init__(self, span):
        """
        Initializes the TracedSpan with the given span.

        Params:
            span (Span): The OpenTelemetry span to be wrapped.
        """

        self._span: Span = span

    def set_result(self, result):
        """
        Sets the result attribute on the underlying span.

        Params:
            result: The result to be set as an attribute on the span.
        """

        self._span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_COMPLETION, result)

    def set_metadata(self, metadata: Dict):
        """
        Sets multiple attributes on the underlying span.

        Params:
            metadata (Dict): A dictionary of attributes to be set on the span.
        """

        self._span.set_attributes(attributes=metadata)

    def __enter__(self):
        """
        Enters the context of the TracedSpan, returning itself.

        Returns:
            TracedSpan: The instance of TracedSpan.
        """

        return self

    def __exit__(self, _exc_type, _exc_val, _exc_tb):
        """
        Exits the context of the TracedSpan by ending the underlying span.
        """

        self._span.end()


@contextmanager
def start_trace(name: str):
    """
    A context manager that starts a new trace and provides a TracedSpan
    for usage within the context.

    Params:
        name (str): The name of the span.

    Yields:
        TracedSpan: The wrapped span for trace operations.
    """

    __trace = t.get_tracer_provider()
    with __trace.get_tracer(__name__).start_as_current_span(
        name,
        kind=SpanKind.CLIENT,
    ) as span:
        yield TracedSpan(span)
