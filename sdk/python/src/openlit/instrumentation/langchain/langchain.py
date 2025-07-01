"""
Module for monitoring LangChain API calls.
"""

import time
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port
)
from openlit.instrumentation.langchain.utils import (
    get_model_from_instance,
    process_chat_response,
    process_hub_response,
)
from openlit.semcov import SemanticConvention

def hub(gen_ai_endpoint, version, environment, application_name, tracer,
        pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for LangChain hub operations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the LangChain hub operation call.
        """

        server_address, server_port = set_server_address_and_port(instance, "langchain.com", 443)

        with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                response = process_hub_response(
                    response=response,
                    gen_ai_endpoint=gen_ai_endpoint,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    span=span,
                    version=version
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper

def chat(gen_ai_endpoint, version, environment, application_name,
         tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI operations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI operation call.
        """

        server_address, server_port = set_server_address_and_port(instance, "langchain.com", 443)
        request_model = get_model_from_instance(instance)

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                # Add instance to kwargs for processing
                kwargs["instance"] = instance

                response = process_chat_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    end_time=end_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    args=args,
                    **kwargs
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper
