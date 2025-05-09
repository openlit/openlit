"""
Module for monitoring AstraDB.
"""

import time
from opentelemetry.trace import SpanKind
from openlit.instrumentation.astra.utils import (
    DB_OPERATION_MAP,
    process_db_operations
)
from openlit.semcov import SemanticConvention

def general_wrap(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for VectorDB function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the VectorDB function call.
        """

        db_operation = DB_OPERATION_MAP.get(gen_ai_endpoint, "UNKNOWN")
        if db_operation == SemanticConvention.DB_OPERATION_REPLACE and kwargs.get('upsert'):
            db_operation = SemanticConvention.DB_OPERATION_UPSERT

        span_name = f"{db_operation} {instance.name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            server_address = getattr(getattr(instance, 'database', instance), 'api_endpoint', '')
            server_port = 443
            collection_name = instance.name
            response = process_db_operations(
                response, span, start_time, gen_ai_endpoint,
                version, environment, application_name, capture_message_content,
                metrics, disable_metrics, server_address, server_port,
                collection_name, db_operation, kwargs, args
            )

            return response

    return wrapper
