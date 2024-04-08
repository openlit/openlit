# pylint: disable=line-too-long
"""
The __init__.py module for the OpenLMT package.
This module sets up the OpenLMT configuration and instrumentation for various large language models (LLMs).
"""

from typing import Any
import logging

# Essential imports for tracing, helper functions, and type hinting
from .otel.__tracing import setup_tracing
from .__helpers import fetch_pricing_info

# Import instrumentors which are responsible for adding tracing to the operations performed by the LLMs
from .openai import OpenAIInstrumentor
from .anthropic import AnthropicInstrumentor
from .cohere import CohereInstrumentor
from .mistral import MistralInstrumentor

# Initialize logging to handle and log errors smoothly
logger = logging.getLogger(__name__)

# pylint: disable=too-few-public-methods
class OpenLMTConfig:
    """
    Configuration class for the OpenLMT package.
    
    Attributes:
        environment: A string specifying the deployment environment.
        application_name: The name of the application using the library.
        pricing_info: A dictionary storing pricing information.
    """

    environment = None
    application_name = None
    pricing_info = {}

def init(environment="default", application_name="default", tracer=None, otlp_endpoint=None, otlp_headers=None, disable_batch=False, trace_content=True):
    """
    Initializes the OpenLMT configuration with the provided parameters and sets up tracing.
    
    Args:
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

        AnthropicInstrumentor().instrument(
            environment=OpenLMTConfig.environment,
            application_name=OpenLMTConfig.application_name,
            tracer=tracer,
            pricing_info=OpenLMTConfig.pricing_info,
            trace_content=trace_content
        )

        MistralInstrumentor().instrument(
            environment=OpenLMTConfig.environment,
            application_name=OpenLMTConfig.application_name,
            tracer=tracer,
            pricing_info=OpenLMTConfig.pricing_info,
            trace_content=trace_content
        )

        CohereInstrumentor().instrument(
            environment=OpenLMTConfig.environment,
            application_name=OpenLMTConfig.application_name,
            tracer=tracer,
            pricing_info=OpenLMTConfig.pricing_info,
            trace_content=trace_content
        )

        OpenAIInstrumentor().instrument(
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

    # If the LLM doesn't match any known clients, return None
    return None
