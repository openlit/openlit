"""
Module for monitoring Amazon Bedrock API calls.
"""

import logging
import time
from botocore.response import StreamingBody
from botocore.exceptions import ReadTimeoutError, ResponseStreamingError
from urllib3.exceptions import ProtocolError as URLLib3ProtocolError
from urllib3.exceptions import ReadTimeoutError as URLLib3ReadTimeoutError
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    response_as_dict,
    create_metrics_attributes,
    set_server_address_and_port
)
from openlit.instrumentation.bedrock.utils import (
    process_chunk,
    process_chat_response,
    process_streaming_chat_response,
)
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def converse(version, environment, application_name, tracer, event_provider,
         pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        def converse_wrapper(original_method, *method_args, **method_kwargs):

            """
            Wraps the GenAI function call.
            """

            server_address, server_port = set_server_address_and_port(instance, 'aws.amazon.com', 443)
            request_model = method_kwargs.get('modelId', 'amazon.titan-text-express-v1')

            span_name = f'{SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT} {request_model}'

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                response = original_method(*method_args, **method_kwargs)
                llm_config = method_kwargs.get('inferenceConfig', {})
                response = process_chat_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    event_provider=event_provider,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    llm_config=llm_config,
                    **method_kwargs
                )

                return response
            
        # Get the original client instance from the wrapper
        client = wrapped(*args, **kwargs)

        # Replace the original method with the instrumented one
        if kwargs.get('service_name') == 'bedrock-runtime':
            original_invoke_model = client.converse
            client.converse = lambda *args, **kwargs: converse_wrapper(original_invoke_model,
                                                                            *args, **kwargs)

        return client

    return wrapper