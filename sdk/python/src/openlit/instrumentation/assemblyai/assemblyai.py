# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment
"""
Module for monitoring Assembly AI API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import get_audio_model_cost
from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def transcribe(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for creating speech audio to collect metrics.
    
    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Assembly AI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of generating speech audio.
        trace_content: Flag indicating whether to trace the input text and generated audio.
    
    Returns:
        A function that wraps the speech audio creation method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'generate' API call to add telemetry.

        This collects metrics such as execution time, cost, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'generate' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'generate' method.
            kwargs: Keyword arguments for the 'generate' method.

        Returns:
            The response from the original 'transcribe' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                llm_model = response.speech_model if response.speech_model else "best"

                # Calculate cost of the operation
                cost = get_audio_model_cost(llm_model,
                                            pricing_info, None, response.audio_duration)

                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_ASSEMBLYAI)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_AUDIO)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                    response.id)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    llm_model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_AUDIO_DURATION,
                                    response.audio_duration)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)

                if trace_content:
                    span.add_event(
                                name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                                attributes={
                                    SemanticConvetion.GEN_AI_CONTENT_PROMPT: response.audio_url,
                                },
                    )
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.text,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_ASSEMBLYAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_AUDIO,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            llm_model,
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
