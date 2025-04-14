"""
Module for monitoring Ollama API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_audio_model_cost,
    handle_exception,
    create_metrics_attributes,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def generate(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for creating speech audio to collect metrics.
    
    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the ElevenLabs API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of generating speech audio.
        capture_message_content: Flag indicating whether to trace the input text and generated audio.
    
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
            The response from the original 'generate' method.
        """

        server_address, server_port = "api.elevenlabs.io", 443
        request_model = kwargs.get('model', kwargs.get('model_id', 'eleven_multilingual_v2'))

        span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} {request_model}'

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                # Calculate cost of the operation
                cost = get_audio_model_cost(request_model,
                                            pricing_info, kwargs.get('text', ''))

                # Set Span attributes
                span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO)
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_ASSEMBLYAI)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvention.SERVER_PORT,
                                    server_port)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                    'audio')

                # Set Span attributes (Extras)
                if gen_ai_endpoint == 'elevenlabs.generate':
                    if isinstance(kwargs.get('voice', 'Rachel'), str):
                        span.set_attribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
                                        kwargs.get('voice', 'Rachel'))
                else:
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_VOICE,
                                        kwargs.get('voice_id', ''))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_RESPONSE_FORMAT,
                                        kwargs.get('output_format', 'mp3'))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_SETTINGS,
                                        str(kwargs.get('voice_settings', '')))
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                        cost)
                    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)
                if capture_message_content:
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_PROMPT: str(kwargs.get('text', '')),
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
                        system=SemanticConvention.GEN_AI_SYSTEM_ELEVENLABS,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=request_model,
                    )

                    metrics['genai_client_operation_duration'].record(
                        end_time - start_time, attributes
                    )
                    metrics['genai_requests'].add(1, attributes)
                    metrics['genai_cost'].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error('Error in trace creation: %s', e)

                # Return original response
                return response

    return wrapper
