# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring Crawl4AI asynchronous calls.
Supports comprehensive 0.7.x operations with business intelligence and enhanced observability.
Includes support for async generators and streaming responses.
"""

import asyncio
import logging
import time
from opentelemetry import trace as trace_api
from opentelemetry.trace import SpanKind
from opentelemetry import context as context_api

from openlit.__helpers import handle_exception, safe_detach
from openlit.instrumentation.crawl4ai.utils import (
    Crawl4AIInstrumentationContext,
    get_operation_name,
    create_crawl_span_name,
    set_crawl_attributes,
    process_crawl_response,
    capture_message_content_if_enabled,
    process_llm_extraction_response,
    create_extraction_span_name,
    capture_extraction_content,
)

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)


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
    Generates a telemetry wrapper for async Crawl4AI operations to collect comprehensive metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the Crawl4AI package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using Crawl4AI.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Crawl4AI usage.
        capture_message_content: Flag indicating whether to trace the actual content.
        metrics: OpenLIT metrics dictionary for performance tracking.
        disable_metrics: Flag to disable metrics collection.

    Returns:
        A function that wraps async Crawl4AI methods to add comprehensive telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps async Crawl4AI operations to add comprehensive telemetry.

        This collects metrics such as execution time, URL information, configuration details,
        and result metrics, while handling errors gracefully for enhanced observability.
        Supports both regular async methods and async generators for streaming.

        Args:
            wrapped: The original async Crawl4AI method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the Crawl4AI method.
            kwargs: Keyword arguments for the Crawl4AI method.

        Returns:
            The response from the original async Crawl4AI method.
        """

        async def async_wrapper():
            # Check if instrumentation is suppressed
            if context_api.get_value(context_api._SUPPRESS_INSTRUMENTATION_KEY):
                return await wrapped(*args, **kwargs)

            # Get operation name and create context
            operation_name = get_operation_name(gen_ai_endpoint)
            ctx = Crawl4AIInstrumentationContext(
                instance, args, kwargs, version, environment, application_name
            )

            # Create span name following the framework guide pattern
            if operation_name == "extract":
                # For extraction operations, determine strategy type from the endpoint
                strategy_type = None
                if "llm" in gen_ai_endpoint:
                    strategy_type = "llm"
                elif "css" in gen_ai_endpoint:
                    strategy_type = "css"
                elif "xpath" in gen_ai_endpoint:
                    strategy_type = "xpath"
                elif "cosine" in gen_ai_endpoint:
                    strategy_type = "cosine"
                elif "regex" in gen_ai_endpoint:
                    strategy_type = "regex"

                target_url = ctx.url if ctx.url != "unknown" else "content"
                span_name = create_extraction_span_name(
                    operation_name, strategy_type, target_url
                )
            else:
                # For crawl operations, use the new improved naming
                span_name = create_crawl_span_name(operation_name, ctx, gen_ai_endpoint)

            # Whether the response streams is only known after awaiting it, so the
            # span cannot be scoped with ``with``: a streaming response is consumed
            # by the caller after this coroutine returns, and a context manager
            # would end the span first, discarding everything the tracked
            # generator records. The span is started detached. ``finally`` ends it
            # for every path that does not hand it to the generator, including
            # ``CancelledError``, which ``except Exception`` does not see. The
            # generator ends it once the stream is exhausted, closed, or dropped.
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            token = context_api.attach(trace_api.set_span_in_context(span))
            start_time = time.time()
            handed_off = False

            try:
                try:
                    # Set comprehensive span attributes
                    set_crawl_attributes(span, ctx, operation_name)

                    # Execute the original async function
                    response = await wrapped(*args, **kwargs)

                    # Handle async generators (streaming responses)
                    if hasattr(response, "__aiter__"):
                        # The tracked generator ends the span once the stream is
                        # exhausted, closed, or discarded.
                        tracked = await _handle_async_generator(
                            span,
                            response,
                            ctx,
                            start_time,
                            operation_name,
                            capture_message_content,
                            metrics,
                            disable_metrics,
                        )
                        handed_off = True
                        return tracked

                    # Handle regular responses. The span ends in ``finally``.
                    return await _handle_regular_response(
                        span,
                        response,
                        ctx,
                        start_time,
                        operation_name,
                        capture_message_content,
                        metrics,
                        disable_metrics,
                        instance,  # Add missing parameter
                        args,  # Add missing parameter
                    )

                except Exception as e:
                    # Calculate duration even for errors
                    end_time = time.time()
                    duration = end_time - start_time
                    span.set_attribute("gen_ai.client.operation.duration", duration)

                    # Handle and log the exception
                    handle_exception(span, e)
                    logger.error("Error in async Crawl4AI operation: %s", e)

                    # Record error metrics if enabled
                    if not disable_metrics and metrics:
                        try:
                            error_key = f"crawl4ai.{operation_name}.error"
                            if error_key not in metrics:
                                metrics[error_key] = 0
                            metrics[error_key] += 1
                        except Exception as metrics_error:
                            logger.debug(
                                "Error recording error metrics: %s", metrics_error
                            )

                    # Re-raise the exception to maintain original behavior.
                    # ``finally`` ends the span.
                    raise
            finally:
                if not handed_off and span.is_recording():
                    span.end()
                safe_detach(token)

        return async_wrapper()

    return wrapper


async def _handle_regular_response(
    span,
    response,
    ctx,
    start_time,
    operation_name,
    capture_message_content,
    metrics,
    disable_metrics,
    instance,
    args,
):
    """Handle regular (non-streaming) async responses."""

    # Calculate duration for business intelligence
    end_time = time.time()
    duration = end_time - start_time
    duration_ms = duration * 1000
    span.set_attribute("gen_ai.client.operation.duration", duration)

    # Process response based on operation type
    if operation_name == "extract":
        # Process extraction strategy response with LLM-specific metrics
        if hasattr(instance, "__class__"):
            # For extraction strategy operations, the instance is the strategy
            process_llm_extraction_response(span, instance, response, ctx)

        # Capture extraction content if enabled
        extraction_input = None
        if len(args) >= 3:
            extraction_input = args[2]  # html content
        elif len(args) >= 2:
            extraction_input = args[1]  # html_content parameter

        capture_extraction_content(
            span, extraction_input, response, capture_message_content
        )
    else:
        # Process crawl operations
        process_crawl_response(span, response, ctx)

        # Capture message content for crawl operations
        capture_message_content_if_enabled(span, ctx, response, capture_message_content)

    # Record metrics if enabled
    if not disable_metrics and metrics:
        try:
            # Record operation metrics
            metrics_key = f"crawl4ai.{operation_name}.duration"
            if metrics_key not in metrics:
                metrics[metrics_key] = []
            metrics[metrics_key].append(duration_ms)

            # Record success/failure metrics
            success_key = f"crawl4ai.{operation_name}.success"
            if success_key not in metrics:
                metrics[success_key] = 0

            # Determine success based on response
            is_success = True
            if hasattr(response, "success"):
                is_success = response.success
            elif isinstance(response, list):
                is_success = all(getattr(r, "success", True) for r in response)

            if is_success:
                metrics[success_key] += 1

        except Exception as metrics_error:
            logger.debug("Error recording metrics: %s", metrics_error)

    return response


async def _handle_async_generator(
    span,
    response_generator,
    ctx,
    start_time,
    operation_name,
    capture_message_content,
    metrics,
    disable_metrics,
):
    """Handle async generator responses (streaming)."""

    class TrackedAsyncGenerator:
        """Async generator wrapper to track streaming results."""

        def __init__(
            self,
            generator,
            span,
            ctx,
            start_time,
            operation_name,
            capture_message_content,
            metrics,
            disable_metrics,
        ):
            self.generator = generator
            self.span = span
            self.ctx = ctx
            self.start_time = start_time
            self.operation_name = operation_name
            self.capture_message_content = capture_message_content
            self.metrics = metrics
            self.disable_metrics = disable_metrics
            self.results = []
            self.completed = False

        def __aiter__(self):
            return self

        def __del__(self):
            """Export a span abandoned by ``async for`` without ``aclose()``.

            This class is not an async generator. ``break`` compiles to a
            return, and ``END_ASYNC_FOR`` does not run, so the loop never
            calls ``aclose()``. The same is true of a return or an exception
            in the loop body. Dealloc cannot await; closing the inner crawl
            stays with that generator's own finalizer once this object drops
            it. Same constraint as the LiteLLM stream wrapper.
            """
            try:
                self._finalize()
            except Exception:  # pylint: disable=broad-except
                pass

        async def __anext__(self):
            try:
                result = await self.generator.__anext__()
                self.results.append(result)

                # Update span with current result
                if hasattr(result, "url"):
                    self.span.set_attribute("gen_ai.crawl.current_url", result.url)

                return result

            except StopAsyncIteration:
                # Generator is complete, finalize metrics
                self._finalize()
                raise
            except (GeneratorExit, asyncio.CancelledError):
                # Not a crawl failure. Record whatever was consumed and end.
                # Do not await the inner close here: this task is already
                # unwinding, and the inner generator is finalized on dealloc.
                self._finalize()
                raise
            except Exception as e:  # pylint: disable=broad-except
                logger.error("Error in streaming crawl operation: %s", e)
                try:
                    await self._close_inner_quietly()
                finally:
                    self._finalize(e)
                raise

        def _finalize(self, error=None):
            """Record streaming telemetry exactly once, then end the span.

            The span is not current here: it outlives ``async_wrapper`` so it
            is still open while the caller consumes this generator. Exhaustion,
            ``aclose()``, cancellation, and ``__del__`` all come through here.
            The ``completed`` flag keeps a repeat call a no-op.

            ``error`` is set only for a failure raised by the stream. Cleanup
            exits leave it unset so a partial crawl is not forced to ERROR.
            Attributes are written before the status: ``process_crawl_response``
            must not stamp OK on a failure, because this SDK then ignores ERROR.
            """
            if self.completed:
                return
            self.completed = True
            try:
                self._record(error)
            except Exception as exc:  # pylint: disable=broad-except
                if error is None:
                    error = exc
                logger.debug("Error finalizing crawl4ai stream: %s", exc)
            finally:
                try:
                    if error is not None:
                        handle_exception(self.span, error)
                finally:
                    if self.span.is_recording():
                        self.span.end()

        async def _close_inner_quietly(self):
            """Close the inner stream without masking the error that aborted it."""
            closer = getattr(self.generator, "aclose", None)
            if closer is None:
                return
            try:
                await closer()
            except Exception as exc:  # pylint: disable=broad-except
                logger.warning("Failed to close crawl4ai stream: %s", exc)

        async def aclose(self):
            """Close the wrapped generator and finalize the span.

            Callers that stop early and still hold the iterator should close
            it so the span ends before the iterator is discarded. ``async for``
            does not call this on ``break``. A second call is a no-op.
            """
            try:
                await self._close_inner_quietly()
            finally:
                self._finalize()

        def _record(self, error):
            """Write duration and the pages consumed so far onto the open span."""
            end_time = time.time()
            duration = end_time - self.start_time
            duration_ms = duration * 1000
            self.span.set_attribute("gen_ai.client.operation.duration", duration)

            # Process aggregated results
            if not self.results:
                return

            # OK would stick and hide the failure status applied by _finalize.
            process_crawl_response(
                self.span, self.results, self.ctx, mark_ok=error is None
            )

            # Capture message content for streaming
            capture_message_content_if_enabled(
                self.span, self.ctx, self.results, self.capture_message_content
            )

            # A failed stream is not a completed one.
            if error is not None or self.disable_metrics or not self.metrics:
                return

            try:
                metrics_key = f"crawl4ai.{self.operation_name}.stream.duration"
                if metrics_key not in self.metrics:
                    self.metrics[metrics_key] = []
                self.metrics[metrics_key].append(duration_ms)

                # Record stream completion
                stream_key = f"crawl4ai.{self.operation_name}.stream.completed"
                if stream_key not in self.metrics:
                    self.metrics[stream_key] = 0
                self.metrics[stream_key] += 1

            except Exception as metrics_error:
                logger.debug(
                    "Error recording streaming metrics: %s", metrics_error
                )

    # Return the tracked generator
    return TrackedAsyncGenerator(
        response_generator,
        span,
        ctx,
        start_time,
        operation_name,
        capture_message_content,
        metrics,
        disable_metrics,
    )
