"""
Module for monitoring Reka API calls.
"""

import time
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port,
    record_completion_metrics,
)
from openlit.instrumentation.reka.utils import process_chat_response
from openlit.semcov import SemanticConvention


def chat(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "api.reka.ai", 443
        )
        request_model = kwargs.get("model", "reka-core-20240501")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)

            try:
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
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                    **kwargs,
                )

            except Exception as e:
                handle_exception(span, e)
                if not disable_metrics and metrics:
                    record_completion_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        SemanticConvention.GEN_AI_SYSTEM_REKAAI,
                        server_address,
                        server_port,
                        request_model,
                        "unknown",
                        environment,
                        application_name,
                        start_time,
                        time.time(),
                        0,
                        0,
                        0,
                        None,
                        None,
                        error_type=type(e).__name__ or "_OTHER",
                    )

            return response

    return wrapper
