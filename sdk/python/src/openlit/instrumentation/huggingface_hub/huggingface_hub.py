"""
Instrumentation for HuggingFace Hub calls.
"""

import logging
from opentelemetry import context as context_api
from opentelemetry.trace import SpanKind

from openlit.instrumentation.huggingface_hub.utils import (
    HFInstrumentationContext,
    get_operation_name,
    get_span_name,
    set_span_attributes,
    process_response,
    handle_hfhub_error,
)

logger = logging.getLogger(__name__)


def general_wrap(
    endpoint,
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    trace_content,
    metrics,
    disable_metrics,
):
    """Create a telemetry wrapper for HuggingFace Hub operations.

    Build a small instrumentation context, start a CLIENT span, set attributes,
    call the wrapped function, and process errors and response telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        # Respect suppression
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        try:
            ctx = HFInstrumentationContext(
                instance, args, kwargs, version, environment, application_name
            )

            operation_name = get_operation_name(endpoint)
            span_name = get_span_name(operation_name, ctx, endpoint)

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                set_span_attributes(
                    span,
                    operation_name,
                    ctx,
                    endpoint=endpoint,
                    pricing_info=pricing_info,
                    trace_content=trace_content,
                    **kwargs,
                )

                try:
                    # Execute the wrapped function - outside try block per framework guide
                    response = wrapped(*args, **kwargs)

                    # Process response and capture telemetry
                    try:
                        process_response(
                            span,
                            response,
                            ctx,
                            endpoint=endpoint,
                            pricing_info=pricing_info,
                            trace_content=trace_content,
                            metrics=metrics,
                            **kwargs,
                        )
                    except Exception as e:
                        handle_hfhub_error(span, e)

                    return response

                except Exception as e:
                    handle_hfhub_error(span, e)
                    raise

        except Exception as e:
            logger.debug("Failed to create huggingface_hub telemetry wrapper: %s", e)
            return wrapped(*args, **kwargs)

    return wrapper


