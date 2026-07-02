# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment, too-many-branches
"""
Module for monitoring async Elasticsearch operations.
"""

import time
from opentelemetry.trace import SpanKind
from opentelemetry import context as context_api
from openlit.__helpers import handle_exception
from openlit.instrumentation.elasticsearch.utils import (
    DB_OPERATION_MAP,
    process_elasticsearch_response,
    set_server_address_and_port,
)


def async_general_wrap(
    gen_ai_endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """
    Generates an async telemetry wrapper for Elasticsearch function calls.
    """
    # pylint: disable=too-many-arguments, too-many-positional-arguments

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps an async Elasticsearch operation with tracing and metrics.
        """
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):  # pylint: disable=protected-access
            return await wrapped(*args, **kwargs)

        db_operation = DB_OPERATION_MAP.get(gen_ai_endpoint, "unknown")
        server_address, server_port = set_server_address_and_port(instance)

        index = kwargs.get("index", args[0] if args else "unknown")
        span_name = f"{db_operation} {index}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)

            try:
                process_elasticsearch_response(
                    response,
                    db_operation,
                    server_address,
                    server_port,
                    environment,
                    application_name,
                    metrics,
                    start_time,
                    span,
                    capture_message_content,
                    disable_metrics,
                    version,
                    endpoint=gen_ai_endpoint,
                    **kwargs,
                )
            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper
