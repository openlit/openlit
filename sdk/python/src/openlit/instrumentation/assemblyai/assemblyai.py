"""
Module for monitoring Assembly AI API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_audio_model_cost,
    handle_exception,
    create_metrics_attributes,
    set_server_address_and_port,
    otel_event
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def transcribe(version, environment, application_name,
                 tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """


    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = set_server_address_and_port(instance, 'api.assemblyai.com', 443)
        request_model = kwargs.get('speech_model', 'best')

        span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} {request_model}'

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                # Calculate cost of the operation
                cost = get_audio_model_cost(request_model,
                                            pricing_info, None, response.audio_duration)

                # Set Span attributes (OTel Semconv)
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
                span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                    'text')

                # Set Span attributes (Extras)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_AUDIO_DURATION,
                                    response.audio_duration)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    cost)
                span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                    version)

                # To be removed one the change to log events (from span events) is complete
                if capture_message_content:
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_PROMPT: response.audio_url,
                        },
                    )
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_COMPLETION: response.text,
                        },
                    )

                input_event = otel_event(
                    name=SemanticConvention.GEN_AI_USER_MESSAGE,
                    attributes={
                        SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_ASSEMBLYAI
                    },
                    body={
                        **({'content': response.audio_url} if capture_message_content else {}),
                        'role': 'user'
                    }
                )
                event_provider.emit(input_event)

                output_event = otel_event(
                    name=SemanticConvention.GEN_AI_CHOICE,
                    attributes={
                        SemanticConvention.GEN_AI_SYSTEM: SemanticConvention.GEN_AI_SYSTEM_ASSEMBLYAI
                    },
                    body={
                        'finish_reason': 'stop',
                        'index': 0,
                        'message': {
                            **({'content': response.text} if capture_message_content else {}),
                            'role': 'assistant'
                        }
                    }
                )
                event_provider.emit(output_event)

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
                        system=SemanticConvention.GEN_AI_SYSTEM_ASSEMBLYAI,
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
