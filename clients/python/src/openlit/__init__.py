"""
The __init__.py module for the openLIT package.
This module sets up the openLIT configuration and instrumentation for various
large language models (LLMs).
"""
from typing import Optional, Dict, Any
import logging

# Import internal modules for setting up tracing and fetching pricing info.
from openlit.otel.__tracing import setup_tracing
from openlit.__helpers import fetch_pricing_info

# Instrumentors for various large language models.
from openlit.instrumentation.openai import OpenAIInstrumentor
from openlit.instrumentation.anthropic import AnthropicInstrumentor
from openlit.instrumentation.cohere import CohereInstrumentor
from openlit.instrumentation.mistral import MistralInstrumentor
from openlit.instrumentation.langchain import LangChainInstrumentor
from openlit.instrumentation.chroma import ChromaInstrumentor
from openlit.instrumentation.pinecone import PineconeInstrumentor
from openlit.instrumentation.transformers import TransformersInstrumentor

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
        cls.pricing_info = fetch_pricing_info()
        cls.tracer = None
        cls.otlp_endpoint = None
        cls.otlp_headers = None
        cls.disable_batch = False
        cls.trace_content = True

    @classmethod
    def update_config(cls, environment, application_name, tracer, otlp_endpoint,
                      otlp_headers, disable_batch, trace_content):
        """
        Updates the configuration based on provided parameters.

        Args:
            environment (str): Deployment environment.
            application_name (str): Application name.
            tracer: Tracer instance.
            otlp_endpoint (str): OTLP endpoint.
            otlp_headers (Dict[str, str]): OTLP headers.
            disable_batch (bool): Disable batch span processing flag.
            trace_content (bool): Enable or disable content tracing.
        """
        cls.environment = environment
        cls.application_name = application_name
        cls.pricing_info = fetch_pricing_info()
        cls.tracer = tracer
        cls.otlp_endpoint = otlp_endpoint
        cls.otlp_headers = otlp_headers
        cls.disable_batch = disable_batch
        cls.trace_content = trace_content

def init(environment="default", application_name="default", tracer=None, otlp_endpoint=None,
         otlp_headers=None, disable_batch=False, trace_content=True, disabled_instrumentors=None):
    """
    Initializes the openLIT configuration and setups tracing.
    
    This function sets up the openLIT environment with provided configurations 
    and initializes instrumentors for tracing.
    
    Args:
        environment (str): Deployment environment.
        application_name (str): Application name.
        tracer: Tracer instance (Optional).
        otlp_endpoint (str): OTLP endpoint for exporter (Optional).
        otlp_headers (Dict[str, str]): OTLP headers for exporter (Optional).
        disable_batch (bool): Flag to disable batch span processing (Optional).
        trace_content (bool): Flag to trace content (Optional).
        disabled_instrumentors (List[str]): Optional. List of instrumentor names to disable.
                                            Valid values include ["openai", "anthropic", 
                                            "langchain", "cohere", "mistral"].
    """
    disabled_instrumentors = disabled_instrumentors if disabled_instrumentors else []

    # Check for invalid instrumentor names
    valid_instruments = {
        "openai", "anthropic", "langchain",
        "cohere", "mistral", "chroma",
        "pinecone", "transformers"
    }
    invalid_instrumentors = set(disabled_instrumentors) - valid_instruments
    for invalid_name in invalid_instrumentors:
        logger.warning("Invalid instrumentor name detected and ignored: '%s'", invalid_name)

    try:
        # Retrieve or create the single configuration instance.
        config = OpenlitConfig()

        # Setup tracing based on the provided or default configuration.
        tracer = setup_tracing(
            application_name=application_name,
            tracer=tracer,
            otlp_endpoint=otlp_endpoint,
            otlp_headers=otlp_headers,
            disable_batch=disable_batch
        )

        if not tracer:
            logger.error("openLIT setup failed. Tracing will not be available.")
            return

        # Update global configuration with the provided settings.
        config.update_config(environment, application_name, tracer, otlp_endpoint,
                             otlp_headers, disable_batch, trace_content)

        # Map instrumentor names to their instances
        instrumentor_instances = {
            "openai": OpenAIInstrumentor(),
            "anthropic": AnthropicInstrumentor(),
            "cohere": CohereInstrumentor(),
            "mistral": MistralInstrumentor(),
            "langchain": LangChainInstrumentor(),
            "chroma": ChromaInstrumentor(),
            "pinecone": PineconeInstrumentor(),
            "transformers": TransformersInstrumentor()
        }

        # Initialize and instrument only the enabled instrumentors
        for name, instrumentor in instrumentor_instances.items():
            if name not in disabled_instrumentors:
                instrumentor.instrument(
                    environment=config.environment,
                    application_name=config.application_name,
                    tracer=config.tracer,
                    pricing_info=config.pricing_info,
                    trace_content=config.trace_content
                )

    # pylint: disable=broad-exception-caught
    except Exception as e:
        logger.error("Error during openLIT initialization: %s", e)
