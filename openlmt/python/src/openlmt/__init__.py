# pylint: disable=line-too-long
"""
The __init__.py module for the OpenLMT package.
This module sets up the OpenLMT configuration and instrumentation for various large language models (LLMs).
"""

from typing import Any
import logging

# Import client libraries for LLMs (Large Language Models) and their respective async variants if available
from anthropic import AsyncAnthropic, Anthropic
from openai import AsyncOpenAI, OpenAI, AzureOpenAI, AsyncAzureOpenAI
from mistralai.async_client import MistralAsyncClient
from mistralai.client import MistralClient

# Essential imports for tracing, helper functions, and type hinting
from .otel.__tracing import setup_tracing
from .__helpers import fetch_pricing_info

# Import instrumentors which are responsible for adding tracing to the operations performed by the LLMs
from .openai import OpenAIInstrumentor, AsyncOpenAIInstrumentor
from .azure_openai import AzureOpenAIInstrumentor, AsyncAzureOpenAIInstrumentor
from .anthropic import AnthropicInstrumentor, AsyncAnthropicInstrumentor
from .cohere import CohereInstrumentor
from .mistral import MistralInstrumentor, AsyncMistralInstrumentor

# Initialize logging to handle and log errors smoothly
logger = logging.getLogger(__name__)

# pylint: disable=too-few-public-methods
class OpenLMTConfig:
    """
    Configuration class for the OpenLMT package.
    
    Attributes:
        llm: The large language model client instance.
        environment: A string specifying the deployment environment.
        application_name: The name of the application using the library.
        pricing_info: A dictionary storing pricing information.
    """

    llm = None
    environment = None
    application_name = None
    pricing_info = {}

def init(llm, environment="default", application_name="default", tracer=None, otlp_endpoint=None, otlp_headers=None, disable_batch=False, trace_content=True):
    """
    Initializes the OpenLMT configuration with the provided parameters and sets up tracing.
    
    Args:
        llm: Instance of the LLM client to be instrumented.
        environment: The deployment environment of the application.
        application_name: Name of the application.
        tracer: Optional custom tracer instance.
        otlp_endpoint: Endpoint for OpenTelemetry Protocol (OTLP) exporter.
        otlp_headers: Headers for OTLP exporter.
        disable_batch: Flag to disable batch span processing.
        trace_content: Flag to disable tracing of prompts and response
    """

    try:
        # Set up the basic configuration
        OpenLMTConfig.llm = llm
        OpenLMTConfig.environment = environment
        OpenLMTConfig.application_name = application_name
        OpenLMTConfig.pricing_info = fetch_pricing_info()

        # Initialize tracing for the application
        tracer = setup_tracing(application_name=application_name, tracer=tracer,
                            otlp_endpoint=otlp_endpoint, otlp_headers=otlp_headers,
                            disable_batch=disable_batch)

        if not tracer:
            logger.error("OpenLMT setup failed. Auto Instrumentation of the LLM client will not proceed.")
            return

        # Proceed with determining and applying the appropriate instrumentor for the provided LLM
        instrumentor = _select_instrumentor(llm)
        if instrumentor:
            instrumentor.instrument(
                llm=OpenLMTConfig.llm,
                environment=OpenLMTConfig.environment,
                application_name=OpenLMTConfig.application_name,
                tracer=tracer,
                pricing_info=OpenLMTConfig.pricing_info,
                trace_content=trace_content
            )

    # pylint: disable=broad-exception-caught
    except Exception as e:
        # Log any error that occurs during the initialization process
        logger.error("Error during OpenLMT initialization: %s", e)

def _select_instrumentor(llm: Any):
    """
    Determines the appropriate instrumentor based on the LLM client instance.
    
    Args:
        llm: The LLM client instance.
    
    Returns:
        The selected instrumentor object if a relevant match is found, otherwise None.
    """

    # Check for each LLM client and return the corresponding instrumentor
    # pylint: disable=no-else-return
    if isinstance(llm, (AsyncOpenAI, OpenAI)) and '.openai.azure.com/' not in str(llm.base_url):
        return AsyncOpenAIInstrumentor() if isinstance(llm, AsyncOpenAI) else OpenAIInstrumentor()
    elif isinstance(llm, (AsyncAzureOpenAI, AzureOpenAI)):
        return AsyncAzureOpenAIInstrumentor() if isinstance(llm, AsyncAzureOpenAI) else AzureOpenAIInstrumentor()
    elif isinstance(llm, (MistralAsyncClient, MistralClient)):
        return AsyncMistralInstrumentor() if isinstance(llm, MistralAsyncClient) else MistralInstrumentor()
    elif isinstance(llm, (AsyncAnthropic, Anthropic)):
        return AsyncAnthropicInstrumentor() if isinstance(llm, AsyncAnthropic) else AnthropicInstrumentor()
    elif hasattr(llm, 'generate') and callable(llm.generate):
        return CohereInstrumentor()

    # If the LLM doesn't match any known clients, return None
    return None
