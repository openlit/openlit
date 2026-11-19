"""
Module for monitoring Firecrawl calls.
Provides comprehensive observability for web scraping and crawling operations.
"""

import logging
from opentelemetry import context as context_api
from opentelemetry.trace import SpanKind

from openlit.instrumentation.firecrawl.utils import (
    _firecrawl_span_active,
    FirecrawlInstrumentationContext,
    get_operation_name,
    get_span_name,
    set_span_attributes,
    process_response,
    handle_firecrawl_error,
    set_operation_duration,
)

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)


def general_wrap(
    endpoint,
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
    Creates a telemetry wrapper for Firecrawl operations to collect comprehensive metrics.

    Args:
        endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using Firecrawl.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Firecrawl usage.
        capture_message_content: Flag indicating whether to trace the actual content.
        metrics: Metrics dictionary for collecting telemetry data.
        disable_metrics: Flag to disable metrics collection.

    Returns:
        A function that wraps Firecrawl methods to add comprehensive telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Enhanced wrapper function with business intelligence and error handling.
        Collects comprehensive telemetry for Firecrawl operations.
        """
        # Implement suppression check per framework guide. Calls made from
        # inside another Firecrawl span (scrape_url -> scrape) are not traced twice.
        if (
            context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY)
            or _firecrawl_span_active.get()
        ):
            return wrapped(*args, **kwargs)

        try:
            # Create context object for caching expensive operations
            ctx = FirecrawlInstrumentationContext(
                instance, args, kwargs, version, environment, application_name
            )

            # Get operation details
            operation_name = get_operation_name(endpoint)
            span_name = get_span_name(operation_name, ctx, endpoint)
        except Exception as e:
            logger.debug("Failed to create firecrawl telemetry wrapper: %s", e)
            return wrapped(*args, **kwargs)

        # Start span with proper hierarchy
        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            # Set comprehensive span attributes
            set_span_attributes(
                span,
                operation_name,
                ctx,
                endpoint=endpoint,
                pricing_info=pricing_info,
                trace_content=capture_message_content,
            )

            # Execute the wrapped function once; its errors propagate unchanged
            dedup_token = _firecrawl_span_active.set(True)
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                handle_firecrawl_error(span, e)
                raise
            finally:
                _firecrawl_span_active.reset(dedup_token)
                set_operation_duration(span, ctx)

            # Process response and capture telemetry
            try:
                process_response(
                    span,
                    response,
                    ctx,
                    endpoint=endpoint,
                    trace_content=capture_message_content,
                )
            except Exception as e:
                handle_firecrawl_error(span, e)

            return response

    return wrapper
