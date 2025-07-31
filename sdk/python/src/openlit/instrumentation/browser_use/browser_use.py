"""
Module for monitoring Browser-Use synchronous operations.
Supports comprehensive agent operations with proper OpenLIT semantic conventions.
"""

import logging
import time
from opentelemetry.trace import SpanKind
from opentelemetry import context as context_api

from openlit.__helpers import handle_exception
from openlit.instrumentation.browser_use.utils import (
    BrowserUseInstrumentationContext,
    get_operation_name,
    create_span_name,
    set_span_attributes,
    process_response,
    capture_token_and_cost_metrics,
)

logger = logging.getLogger(__name__)


def general_wrap(
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
    Generates a telemetry wrapper for Browser-Use synchronous operations.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the Browser-Use package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using Browser-Use.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of operations.
        capture_message_content: Flag indicating whether to trace the actual content.
        metrics: OpenLIT metrics dictionary for performance tracking.
        disable_metrics: Flag to disable metrics collection.

    Returns:
        A function that wraps Browser-Use methods to add comprehensive telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps Browser-Use operations to add comprehensive telemetry.

        This collects metrics such as execution time, agent operations, and browser actions,
        while handling errors gracefully for enhanced observability.

        Args:
            wrapped: The original Browser-Use method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the Browser-Use method.
            kwargs: Keyword arguments for the Browser-Use method.

        Returns:
            The response from the original Browser-Use method.
        """

        # Check if instrumentation is suppressed
        if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
            return wrapped(*args, **kwargs)

        # Get operation name and create context
        operation_name = get_operation_name(gen_ai_endpoint)
        ctx = BrowserUseInstrumentationContext(
            instance, args, kwargs, version, environment, application_name
        )

        # Create span name following the OpenLIT pattern
        span_name = create_span_name(operation_name, ctx)

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()

            try:
                # Set comprehensive span attributes using proper semantic conventions
                set_span_attributes(span, operation_name, ctx)

                # Execute the original function
                logger.debug("Executing Browser-Use operation: %s", operation_name)
                response = wrapped(*args, **kwargs)

                # Calculate duration
                end_time = time.time()
                duration_ms = (end_time - start_time) * 1000
                span.set_attribute("gen_ai.client.operation.duration", duration_ms)

                # Process response based on operation type
                process_response(span, response, ctx, capture_message_content)

                # Capture token usage and cost metrics if available
                model_name = ctx.model_name
                if model_name != "unknown" and pricing_info:
                    capture_token_and_cost_metrics(
                        span, response, model_name, pricing_info
                    )

                # Record metrics if enabled
                if not disable_metrics and metrics:
                    _record_operation_metrics(
                        metrics, operation_name, duration_ms, True
                    )

                return response

            except Exception as e:
                # Calculate duration even for errors
                end_time = time.time()
                duration_ms = (end_time - start_time) * 1000
                span.set_attribute("gen_ai.client.operation.duration", duration_ms)

                # Handle and log the exception
                handle_exception(span, e)
                logger.error("Error in Browser-Use operation %s: %s", operation_name, e)

                # Record error metrics if enabled
                if not disable_metrics and metrics:
                    _record_operation_metrics(
                        metrics, operation_name, duration_ms, False
                    )

                # Re-raise the exception to maintain original behavior
                raise

    return wrapper


def _record_operation_metrics(metrics, operation_name, duration_ms, is_success):
    """Record operation metrics for performance tracking."""

    try:
        # Record duration metrics
        duration_key = f"browser_use.{operation_name}.duration"
        if duration_key not in metrics:
            metrics[duration_key] = []
        metrics[duration_key].append(duration_ms)

        # Record success/error metrics
        if is_success:
            success_key = f"browser_use.{operation_name}.success"
            if success_key not in metrics:
                metrics[success_key] = 0
            metrics[success_key] += 1
        else:
            error_key = f"browser_use.{operation_name}.error"
            if error_key not in metrics:
                metrics[error_key] = 0
            metrics[error_key] += 1

    except Exception as e:
        logger.debug("Error recording operation metrics: %s", e)
