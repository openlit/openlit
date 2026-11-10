"""
Module for monitoring VertexAI API calls.
"""

import logging
import time
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    record_completion_metrics,
    safe_detach,
)
from openlit.instrumentation.vertexai.utils import (
    process_chunk,
    process_chat_response,
    process_streaming_chat_response,
    extract_vertexai_details,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)


def async_send_message(
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
    Generates a telemetry wrapper for VertexAI AsyncMessages calls.
    """

    class TracedAsyncStream:
        """
        Wrapper for async streaming responses to collect telemetry.
        """

        def __init__(
            self,
            wrapped,
            span,
            span_name,
            kwargs,
            server_address,
            server_port,
            request_model,
            args,
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._span_name = span_name
            self._llmresponse = ""
            self._input_tokens = 0
            self._output_tokens = 0
            self._reasoning_tokens = 0
            self._cache_read_input_tokens = 0
            self._cache_creation_input_tokens = 0
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port
            self._request_model = request_model
            self._args = args
            self._streaming_response_processed = False
            self._stream_error = None
            # None stays off the span. "" would emit an empty finish reason
            # on a clean drain, because process_chunk never sets one.
            self._finish_reason = None

        async def __aenter__(self):
            # generate_content_async(stream=True) returns an async generator.
            # Those have no __aenter__.
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            await self.aclose()

        def __aiter__(self):
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(self.__wrapped__, name)

        async def aclose(self):
            """Close the wrapped async generator and finalize the span if it has not ended yet."""
            try:
                await self.__wrapped__.aclose()
            finally:
                self._finalize_streaming_span(ended_cleanly=False)

        async def close(self):
            """Alias for aclose(), kept for callers using the older name."""
            await self.aclose()

        def __del__(self):
            """Finalize a span abandoned by a bare ``async for`` loop.

            Dealloc cannot await ``aclose()``. The wrapped async generator's
            own dealloc hook still closes the RPC stream.
            """
            try:
                self._finalize_streaming_span(ended_cleanly=False)
            except Exception:
                pass

        def _finalize_streaming_span(self, ended_cleanly):
            """End the span once.

            ``ended_cleanly`` is True only for StopAsyncIteration. An empty
            finish reason is otherwise a cancel. A failure raised by the
            wrapped stream is recorded after attributes are set, so partial
            text stays on the span and the status is ERROR rather than the
            OK that ``process_streaming_chat_response`` writes when nothing
            failed.
            """
            if self._streaming_response_processed:
                return
            self._streaming_response_processed = True
            if self._stream_error is not None and not self._finish_reason:
                self._finish_reason = "error"
            elif not ended_cleanly and not self._finish_reason:
                self._finish_reason = "incomplete"
            try:
                with self._span:
                    try:
                        process_streaming_chat_response(
                            self,
                            pricing_info=pricing_info,
                            environment=environment,
                            application_name=application_name,
                            metrics=metrics,
                            capture_message_content=capture_message_content,
                            disable_metrics=disable_metrics,
                            version=version,
                            event_provider=event_provider,
                        )
                    finally:
                        if self._stream_error is not None:
                            handle_exception(self._span, self._stream_error)
            except Exception as e:
                handle_exception(self._span, e)

        async def __anext__(self):
            try:
                chunk = await self.__wrapped__.__anext__()
                process_chunk(self, chunk)
                return chunk
            except StopAsyncIteration:
                self._finalize_streaming_span(ended_cleanly=True)
                raise
            except Exception as exc:
                self._stream_error = exc
                raise

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the VertexAI async API call to add telemetry.
        """

        streaming = kwargs.get("stream", False)
        server_address, server_port, request_model = extract_vertexai_details(instance)

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        if streaming:
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            ctx = trace_api.set_span_in_context(span)
            token = context_api.attach(ctx)
            try:
                awaited_wrapped = await wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                safe_detach(token)
                span.end()
                raise
            safe_detach(token)

            return TracedAsyncStream(
                awaited_wrapped,
                span,
                span_name,
                kwargs,
                server_address,
                server_port,
                request_model,
                args,
            )

        else:
            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                response = await wrapped(*args, **kwargs)

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
                            SemanticConvention.GEN_AI_SYSTEM_VERTEXAI,
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
