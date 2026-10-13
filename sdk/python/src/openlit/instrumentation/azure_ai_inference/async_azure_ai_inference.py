"""
Module for monitoring Azure AI Inference API calls.
"""

import logging
import time
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port,
    record_completion_metrics,
    record_embedding_metrics,
)
from openlit.instrumentation.azure_ai_inference.utils import (
    process_chunk,
    process_chat_response,
    process_streaming_chat_response,
    process_embedding_response,
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)


def async_complete(
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

    class TracedAsyncStream:  # pylint: disable=too-many-instance-attributes
        """
        Wrapper for streaming responses to collect telemetry.
        """

        def __init__(
            self,
            wrapped,
            span,
            span_name,
            kwargs,
            server_address,
            server_port,
            event_provider=None,
            **args,
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._span_name = span_name
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._response_service_tier = ""
            self._tools = None
            self._input_tokens = 0
            self._output_tokens = 0
            # Do not default _reasoning_tokens. Absence means no usage was
            # received yet; a literal 0 is a measured zero and would be emitted
            # as reported=true if the stream ends without a usage chunk.
            self._cache_read_input_tokens = 0
            self._cache_creation_input_tokens = 0

            self._args = args
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port
            self._event_provider = event_provider
            self._streaming_response_processed = False
            self._stream_error = None

        async def __aenter__(self):
            await self.__wrapped__.__aenter__()
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            try:
                await self.__wrapped__.__aexit__(exc_type, exc_val, exc_tb)
            finally:
                # Exhaustion already ended the span. Leave that export alone,
                # including when the body raises after the stream is consumed.
                # Do not return from this finally: a return would swallow an
                # exception raised by the wrapped __aexit__.
                if not self._streaming_response_processed:
                    stream_error = exc_val if exc_type is not None else None
                    # A break never hits StopAsyncIteration, so a clean exit is a cancel.
                    self._finalize_streaming_span(False, stream_error)

        def __aiter__(self):
            return self

        async def __anext__(self):
            try:
                chunk = await self.__wrapped__.__anext__()
            except StopAsyncIteration:
                self._finalize_streaming_span(True)
                raise
            except Exception as exc:
                await self._abort_stream(exc, close_wrapped=True)
                raise
            try:
                process_chunk(self, chunk)
            except Exception as exc:
                # The chunk itself failed instrumentation. Leave the SDK
                # stream open so a surrounding ``async with`` can still close it.
                await self._abort_stream(exc, close_wrapped=False)
                raise
            return chunk

        def __getattr__(self, name):
            return getattr(self.__wrapped__, name)

        async def _close_wrapped_quietly(self):
            """Close the SDK stream without masking the error that aborted it."""
            try:
                await self.__wrapped__.aclose()
            except Exception as exc:
                logger.warning("Failed to close Azure AI Inference stream: %s", exc)

        async def _abort_stream(self, exc, close_wrapped):
            """End the span for a stream or chunk failure."""
            if close_wrapped:
                await self._close_wrapped_quietly()
            self._finalize_streaming_span(False, exc)

        def _finalize_streaming_span(self, ended_cleanly, stream_error=None):
            """Complete and end the span exactly once.

            ``ended_cleanly`` is True only for StopAsyncIteration. Any other
            exit with no finish reason is ``incomplete``, or ``error`` when
            ``stream_error`` is set. Partial text and usage are written first.
            A failed stream does not set OK, because the SDK ignores a later
            ERROR. The error status is applied while the span is still recording.
            """
            if self._streaming_response_processed:
                return
            self._streaming_response_processed = True
            if stream_error is not None:
                # common_chat_logic reads this for the metrics error.type.
                self._stream_error = stream_error
                if not self._finish_reason:
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
                            event_provider=self._event_provider,
                        )
                    except Exception as exc:
                        if stream_error is None:
                            stream_error = exc
                            self._stream_error = exc
                        raise
                    finally:
                        if stream_error is not None:
                            handle_exception(self._span, stream_error)
            except Exception as exc:
                if self._span.is_recording():
                    handle_exception(self._span, exc)
                    self._span.end()

        async def aclose(self):
            """Close the wrapped stream and finalize the span if not ended.

            azure-ai-inference's AsyncStreamingChatCompletions exposes
            ``aclose()``, not ``close()``. A wrapped aclose that raises still
            exports the span. That close error is not a model failure, so it
            is not stored as one.
            """
            try:
                await self.__wrapped__.aclose()
            finally:
                self._finalize_streaming_span(False)

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        streaming = kwargs.get("stream", False)
        server_address, server_port = set_server_address_and_port(
            instance, "models.github.ai", 443
        )
        request_model = kwargs.get("model", "gpt-4o")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        if streaming:
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            ctx = trace_api.set_span_in_context(span)
            token = context_api.attach(ctx)
            try:
                awaited_wrapped = await wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                context_api.detach(token)
                span.end()
                raise
            context_api.detach(token)

            return TracedAsyncStream(
                awaited_wrapped,
                span,
                span_name,
                kwargs,
                server_address,
                server_port,
                event_provider=event_provider,
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
                            SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE,
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


def async_embed(
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
    Generates a telemetry wrapper for GenAI embedding function call
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI embedding function call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "models.github.ai", 443
        )
        request_model = kwargs.get("model", "text-embedding-3-small")

        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)

            try:
                response = process_embedding_response(
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
                    record_embedding_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                        SemanticConvention.GEN_AI_SYSTEM_AZURE_AI_INFERENCE,
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
                        error_type=type(e).__name__ or "_OTHER",
                    )

            return response

    return wrapper
