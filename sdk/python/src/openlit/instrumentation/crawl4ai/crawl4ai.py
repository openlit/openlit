# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring Crawl4AI calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import (
    handle_exception,
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def wrap_crawl(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Crawl4AI Agent.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Crawl4AI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'chat.completions' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'chat.completions' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'chat.completions' method.
            kwargs: Keyword arguments for the 'chat.completions' method.

        Returns:
            The response from the original 'chat.completions' method.
        """

        # pylint: disable=line-too-long
        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                # Set base span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_CRAWL4AI)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_AGENT)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_AGENT_TYPE,
                                    SemanticConvetion.GEN_AI_AGENT_TYPE_BROWSER)
                span.set_attribute(SemanticConvetion.GEN_AI_AGENT_ENABLE_CACHE, not kwargs.get("disable_cache", False))

                url = kwargs.get("url") if "url" in kwargs else str(args[0]) if args else None
                if url is not None:
                    span.set_attribute(SemanticConvetion.GEN_AI_AGENT_BROWSE_URL, url)

                extraction_strategy = kwargs.get("extraction_strategy", "NoExtractionStrategy")
                extraction_name = extraction_strategy.name if hasattr(extraction_strategy, 'name') else extraction_strategy

                span.set_attribute(SemanticConvetion.GEN_AI_AGENT_STRATEGY, extraction_name)

                if extraction_name == "LLMExtractionStrategy" and hasattr(extraction_strategy, 'provider'):
                    _, llm_model = extraction_strategy.provider.split('/')
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL, llm_model)

                elif extraction_name == "CosineStrategy":
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL, "all-MiniLM-L6-v2")

                elif extraction_name == "JsonCssExtractionStrategy" and hasattr(extraction_strategy, 'schema'):
                    span.set_attribute(SemanticConvetion.GEN_AI_AGENT_SCHEMA, str(extraction_strategy.schema))

                span.set_status(Status(StatusCode.OK))

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
