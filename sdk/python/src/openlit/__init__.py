# pylint: disable=broad-exception-caught
"""
The __init__.py module for the openLIT package.
This module sets up the openLIT configuration and instrumentation for various
large language models (LLMs).
"""

from typing import Dict
import logging
import os
from importlib.util import find_spec
from functools import wraps
from contextlib import contextmanager
import requests


# Import internal modules for setting up tracing and fetching pricing info.
from opentelemetry import trace as t
from opentelemetry.trace import SpanKind, Status, StatusCode, Span
from opentelemetry.sdk.resources import SERVICE_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.semcov import SemanticConvention
from openlit.otel.tracing import setup_tracing
from openlit.otel.metrics import setup_meter
from openlit.otel.events import setup_events
from openlit.__helpers import fetch_pricing_info, get_env_variable

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
from openlit.instrumentation.reka import RekaInstrumentor
from openlit.instrumentation.premai import PremAIInstrumentor
from openlit.instrumentation.assemblyai import AssemblyAIInstrumentor
from openlit.instrumentation.azure_ai_inference import AzureAIInferenceInstrumentor
from openlit.instrumentation.langchain import LangChainInstrumentor
from openlit.instrumentation.llamaindex import LlamaIndexInstrumentor
from openlit.instrumentation.haystack import HaystackInstrumentor
from openlit.instrumentation.embedchain import EmbedChainInstrumentor
from openlit.instrumentation.mem0 import Mem0Instrumentor
from openlit.instrumentation.chroma import ChromaInstrumentor
from openlit.instrumentation.pinecone import PineconeInstrumentor
from openlit.instrumentation.qdrant import QdrantInstrumentor
from openlit.instrumentation.milvus import MilvusInstrumentor
from openlit.instrumentation.astra import AstraInstrumentor
from openlit.instrumentation.transformers import TransformersInstrumentor
from openlit.instrumentation.litellm import LiteLLMInstrumentor
from openlit.instrumentation.together import TogetherInstrumentor
from openlit.instrumentation.crewai import CrewAIInstrumentor
from openlit.instrumentation.ag2 import AG2Instrumentor
from openlit.instrumentation.multion import MultiOnInstrumentor
from openlit.instrumentation.dynamiq import DynamiqInstrumentor
from openlit.instrumentation.phidata import PhidataInstrumentor
from openlit.instrumentation.julep import JulepInstrumentor
from openlit.instrumentation.ai21 import AI21Instrumentor
from openlit.instrumentation.controlflow import ControlFlowInstrumentor
from openlit.instrumentation.crawl4ai import Crawl4AIInstrumentor
from openlit.instrumentation.firecrawl import FireCrawlInstrumentor
from openlit.instrumentation.letta import LettaInstrumentor
from openlit.instrumentation.openai_agents import OpenAIAgentsInstrumentor
from openlit.instrumentation.gpu import GPUInstrumentor
import openlit.guard
import openlit.evals

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
        event_provider (Optional[Any]): Event logger provider for OpenTelemetry.
        otlp_endpoint (Optional[str]): Endpoint for OTLP.
        otlp_headers (Optional[Dict[str, str]]): Headers for OTLP.
        disable_batch (bool): Flag to disable batch span processing in tracing.
        capture_message_content (bool): Flag to enable or disable tracing of content.
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
        cls.event_provider = None
        cls.metrics_dict = {}
        cls.otlp_endpoint = None
        cls.otlp_headers = None
        cls.disable_batch = False
        cls.capture_message_content = True
        cls.disable_metrics = False

    @classmethod
    def update_config(
        cls,
        environment,
        application_name,
        tracer,
        event_provider,
        otlp_endpoint,
        otlp_headers,
        disable_batch,
        capture_message_content,
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
            event_provider: Event logger provider instance.
            meter: Metric Instance
            otlp_endpoint (str): OTLP endpoint.
            otlp_headers (Dict[str, str]): OTLP headers.
            disable_batch (bool): Disable batch span processing flag.
            capture_message_content (bool): Enable or disable content tracing.
            metrics_dict: Dictionary of metrics.
            disable_metrics (bool): Flag to disable metrics.
            pricing_json(str): path or url to the pricing json file
        """
        cls.environment = environment
        cls.application_name = application_name
        cls.pricing_info = fetch_pricing_info(pricing_json)
        cls.tracer = tracer
        cls.event_provider = event_provider
        cls.metrics_dict = metrics_dict
        cls.otlp_endpoint = otlp_endpoint
        cls.otlp_headers = otlp_headers
        cls.disable_batch = disable_batch
        cls.capture_message_content = capture_message_content
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
                event_provider=config.event_provider,
                pricing_info=config.pricing_info,
                capture_message_content=config.capture_message_content,
                metrics_dict=config.metrics_dict,
                disable_metrics=config.disable_metrics,
            )
        else:
            # pylint: disable=line-too-long
            logger.info(
                "Library for %s (%s) not found. Skipping instrumentation",
                instrumentor_name,
                module_name,
            )
    except Exception as e:
        logger.error("Failed to instrument %s: %s", instrumentor_name, e)


def init(
    environment="default",
    application_name="default",
    tracer=None,
    event_logger=None,
    otlp_endpoint=None,
    otlp_headers=None,
    disable_batch=False,
    capture_message_content=True,
    disabled_instrumentors=None,
    meter=None,
    disable_metrics=False,
    pricing_json=None,
    collect_gpu_stats=False,
):
    """
    Initializes the openLIT configuration and setups tracing.

    This function sets up the openLIT environment with provided configurations
    and initializes instrumentors for tracing.

    Args:
        environment (str): Deployment environment.
        application_name (str): Application name.
        tracer: Tracer instance (Optional).
        event_logger: EventLoggerProvider instance (Optional).
        meter: OpenTelemetry Metrics Instance (Optional).
        otlp_endpoint (str): OTLP endpoint for exporter (Optional).
        otlp_headers (Dict[str, str]): OTLP headers for exporter (Optional).
        disable_batch (bool): Flag to disable batch span processing (Optional).
        capture_message_content (bool): Flag to trace content (Optional).
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
        "google-ai-studio": "google.genai",
        "azure-ai-inference": "azure.ai.inference",
        "langchain": "langchain",
        "llama_index": "llama_index",
        "haystack": "haystack",
        "embedchain": "embedchain",
        "mem0": "mem0",
        "chroma": "chromadb",
        "pinecone": "pinecone",
        "qdrant": "qdrant_client",
        "milvus": "pymilvus",
        "transformers": "transformers",
        "litellm": "litellm",
        "crewai": "crewai",
        "ag2": "ag2",
        "autogen": "autogen",
        "pyautogen": "pyautogen",
        "multion": "multion",
        "dynamiq": "dynamiq",
        "phidata": "phi",
        "reka-api": "reka",
        "premai": "premai",
        "julep": "julep",
        "astra": "astrapy",
        "ai21": "ai21",
        "controlflow": "controlflow",
        "assemblyai": "assemblyai",
        "crawl4ai": "crawl4ai",
        "firecrawl": "firecrawl",
        "letta": "letta",
        "together": "together",
        "openai-agents": "agents"
    }

    invalid_instrumentors = [
        name for name in disabled_instrumentors if name not in module_name_map
    ]
    for invalid_name in invalid_instrumentors:
        logger.warning(
            "Invalid instrumentor name detected and ignored: '%s'", invalid_name
        )

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
            logger.error("OpenLIT tracing setup failed. Tracing will not be available.")
            return

        # Setup events based on the provided or default configuration.
        event_provider = setup_events(
                application_name=application_name,
                environment=environment,
                event_logger=event_logger,
                otlp_endpoint=None,
                otlp_headers=None,
                disable_batch=disable_batch,
            )

        if not event_provider:
            logger.error("OpenLIT events setup failed. Events will not be available")

        # Setup meter and receive metrics_dict instead of meter.
        metrics_dict, err = setup_meter(
            application_name=application_name,
            environment=environment,
            meter=meter,
            otlp_endpoint=otlp_endpoint,
            otlp_headers=otlp_headers,
        )

        if err:
            logger.error(
                "OpenLIT metrics setup failed. Metrics will not be available: %s", err
            )
            return

        if os.getenv("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "").lower == "false":
            capture_message_content=False

        # Update global configuration with the provided settings.
        config.update_config(
            environment,
            application_name,
            tracer,
            event_provider,
            otlp_endpoint,
            otlp_headers,
            disable_batch,
            capture_message_content,
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
            "mem0": Mem0Instrumentor(),
            "chroma": ChromaInstrumentor(),
            "pinecone": PineconeInstrumentor(),
            "qdrant": QdrantInstrumentor(),
            "milvus": MilvusInstrumentor(),
            "transformers": TransformersInstrumentor(),
            "litellm": LiteLLMInstrumentor(),
            "crewai": CrewAIInstrumentor(),
            "ag2": AG2Instrumentor(),
            "multion": MultiOnInstrumentor(),
            "autogen": AG2Instrumentor(),
            "pyautogen": AG2Instrumentor(),
            "dynamiq": DynamiqInstrumentor(),
            "phidata": PhidataInstrumentor(),
            "reka-api": RekaInstrumentor(),
            "premai": PremAIInstrumentor(),
            "julep": JulepInstrumentor(),
            "astra": AstraInstrumentor(),
            "ai21": AI21Instrumentor(),
            "controlflow": ControlFlowInstrumentor(),
            "assemblyai": AssemblyAIInstrumentor(),
            "crawl4ai": Crawl4AIInstrumentor(),
            "firecrawl": FireCrawlInstrumentor(),
            "letta": LettaInstrumentor(),
            "together": TogetherInstrumentor(),
            "openai-agents": OpenAIAgentsInstrumentor(),
        }

        # Initialize and instrument only the enabled instrumentors
        for name, instrumentor in instrumentor_instances.items():
            instrument_if_available(
                name, instrumentor, config, disabled_instrumentors, module_name_map
            )

        if not disable_metrics and collect_gpu_stats:
            GPUInstrumentor().instrument(
                environment=config.environment,
                application_name=config.application_name,
            )
    except Exception as e:
        logger.error("Error during openLIT initialization: %s", e)


def get_prompt(
    url=None,
    name=None,
    api_key=None,
    prompt_id=None,
    version=None,
    should_compile=None,
    variables=None,
    meta_properties=None,
):
    """
    Retrieve and returns the prompt from OpenLIT Prompt Hub
    """

    # Validate and set the base URL
    url = get_env_variable(
        "OPENLIT_URL",
        url,
        "Missing OpenLIT URL: Provide as arg or set OPENLIT_URL env var.",
    )

    # Validate and set the API key
    api_key = get_env_variable(
        "OPENLIT_API_KEY",
        api_key,
        "Missing API key: Provide as arg or set OPENLIT_API_KEY env var.",
    )

    # Construct the API endpoint
    endpoint = url + "/api/prompt/get-compiled"

    # Prepare the payload
    payload = {
        "name": name,
        "promptId": prompt_id,
        "version": version,
        "shouldCompile": should_compile,
        "variables": variables,
        "metaProperties": meta_properties,
        "source": "python-sdk",
    }

    # Remove None values from payload
    payload = {k: v for k, v in payload.items() if v is not None}

    # Prepare headers
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        # Make the POST request to the API with headers
        response = requests.post(endpoint, json=payload, headers=headers, timeout=120)

        # Check if the response is successful
        response.raise_for_status()

        # Return the JSON response
        return response.json()
    except requests.RequestException as error:
        logger.error("Error fetching prompt: '%s'", error)
        return None


def get_secrets(url=None, api_key=None, key=None, tags=None, should_set_env=None):
    """
    Retrieve & returns the secrets from OpenLIT Vault & sets all to env is should_set_env is True
    """

    # Validate and set the base URL
    url = get_env_variable(
        "OPENLIT_URL",
        url,
        "Missing OpenLIT URL: Provide as arg or set OPENLIT_URL env var.",
    )

    # Validate and set the API key
    api_key = get_env_variable(
        "OPENLIT_API_KEY",
        api_key,
        "Missing API key: Provide as arg or set OPENLIT_API_KEY env var.",
    )

    # Construct the API endpoint
    endpoint = url + "/api/vault/get-secrets"

    # Prepare the payload
    payload = {"key": key, "tags": tags, "source": "python-sdk"}

    # Remove None values from payload
    payload = {k: v for k, v in payload.items() if v is not None}

    # Prepare headers
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        # Make the POST request to the API with headers
        response = requests.post(endpoint, json=payload, headers=headers, timeout=120)

        # Check if the response is successful
        response.raise_for_status()

        # Return the JSON response
        vault_response = response.json()

        res = vault_response.get("res", [])

        if should_set_env is True:
            for token, value in res.items():
                os.environ[token] = str(value)
        return vault_response
    except requests.RequestException as error:
        logger.error("Error fetching secrets: '%s'", error)
        return None


def trace(wrapped):
    """
    Generates a telemetry wrapper for messages to collect metrics.
    """
    if not callable(wrapped):
        raise TypeError(
            f"@trace can only be applied to callable objects, got {type(wrapped).__name__}"
        )

    try:
        __trace = t.get_tracer_provider()
        tracer = __trace.get_tracer(__name__)
    except Exception as tracer_exception:
        logging.error(
            "Failed to initialize tracer: %s", tracer_exception, exc_info=True
        )
        raise

    @wraps(wrapped)
    def wrapper(*args, **kwargs):
        with tracer.start_as_current_span(
            name=wrapped.__name__,
            kind=SpanKind.CLIENT,
        ) as span:
            response = None
            try:
                response = wrapped(*args, **kwargs)
                span.set_attribute(
                    SemanticConvention.GEN_AI_CONTENT_COMPLETION, response or ""
                )
                span.set_status(Status(StatusCode.OK))
            except Exception as e:
                span.record_exception(e)
                span.set_status(status=Status(StatusCode.ERROR), description=str(e))
                logging.error("Error in %s: %s", wrapped.__name__, e, exc_info=True)
                raise

            try:
                span.set_attribute("function.args", str(args))
                span.set_attribute("function.kwargs", str(kwargs))
                span.set_attribute(
                    SERVICE_NAME,
                    OpenlitConfig.application_name,
                )
                span.set_attribute(
                    DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment
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

        self._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, result)

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
