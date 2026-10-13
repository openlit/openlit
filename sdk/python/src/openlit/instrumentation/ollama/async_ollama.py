"""
Module for monitoring Ollama API calls.
"""

import time
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port,
    record_completion_metrics,
    record_embedding_metrics,
)
from openlit.instrumentation.ollama.utils import (
    process_chunk,
    process_chat_response,
    process_streaming_chat_response,
    process_generate_response,
    process_streaming_generate_response,
    process_embedding_response,
)
from openlit.semcov import SemanticConvention


def async_chat(
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
    Generates a telemetry wrapper for Ollama async chat function call
    """

    class TracedAsyncStream:
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
            args,
            event_provider=None,
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._llmresponse = ""
            self._response_model = ""
            self._finish_reason = ""
            self._tools = []
            self._input_tokens = 0
            self._output_tokens = 0
            self._cache_read_input_tokens = 0
            self._cache_creation_input_tokens = 0
            self._response_role = ""
            self._span_name = span_name
            self._args = args
            self._kwargs = kwargs
            self._start_time = time.monotonic()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port
            self._event_provider = event_provider

        async def __aenter__(self):
            await self.__wrapped__.__aenter__()
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            await self.__wrapped__.__aexit__(exc_type, exc_value, traceback)

        def __aiter__(self):
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(self.__wrapped__, name)

        async def __anext__(self):
            try:
                chunk = await self.__wrapped__.__anext__()
                process_chunk(self, chunk)
                return chunk
            except StopAsyncIteration:
                try:
                    with self._span:
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
                except Exception as e:
                    handle_exception(self._span, e)

                raise

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the Ollama async chat function call.
        """

        streaming = kwargs.get("stream", False)

        server_address, server_port = set_server_address_and_port(
            instance, "127.0.0.1", 11434
        )
        json_body = kwargs.get("json", {}) or {}
        request_model = json_body.get("model") or kwargs.get("model")

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
                args,
                event_provider,
            )

        else:
            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.monotonic()

                response = await wrapped(*args, **kwargs)

                try:
                    response = process_chat_response(
                        response=response,
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
                            SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
                            server_address,
                            server_port,
                            request_model or "unknown",
                            "unknown",
                            environment,
                            application_name,
                            start_time,
                            time.monotonic(),
                            0,
                            0,
                            0,
                            None,
                            None,
                            error_type=type(e).__name__ or "_OTHER",
                        )

            return response

    return wrapper


def async_generate(
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
    Generates a telemetry wrapper for Ollama async generate function call
    """

    class TracedAsyncStream:
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
            args,
            event_provider=None,
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._llmresponse = ""
            self._response_model = ""
            self._finish_reason = ""
            self._tools = []
            self._input_tokens = 0
            self._output_tokens = 0
            self._cache_read_input_tokens = 0
            self._cache_creation_input_tokens = 0
            self._response_role = ""
            self._span_name = span_name
            self._args = args
            self._kwargs = kwargs
            self._start_time = time.monotonic()
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
            # Ollama generate stream is an async generator, which has no __aenter__.
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
            own dealloc hook still closes the HTTP response.
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
            OK that ``process_streaming_generate_response`` writes when
            nothing failed.
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
                        process_streaming_generate_response(
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
        Wraps the Ollama async chat function call.
        """

        streaming = kwargs.get("stream", False)

        server_address, server_port = set_server_address_and_port(
            instance, "127.0.0.1", 11434
        )
        json_body = kwargs.get("json", {}) or {}
        request_model = json_body.get("model") or kwargs.get("model")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION} {request_model}"

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
                args,
                event_provider,
            )

        else:
            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.monotonic()

                response = await wrapped(*args, **kwargs)

                try:
                    response = process_generate_response(
                        response=response,
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
                            SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
                            SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
                            server_address,
                            server_port,
                            request_model or "unknown",
                            "unknown",
                            environment,
                            application_name,
                            start_time,
                            time.monotonic(),
                            0,
                            0,
                            0,
                            None,
                            None,
                            error_type=type(e).__name__ or "_OTHER",
                        )

            return response

    return wrapper


def async_embeddings(
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
    Generates a telemetry wrapper for Ollama async embeddings function call
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the Ollama async embeddings function call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "127.0.0.1", 11434
        )
        request_model = kwargs.get("model")

        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.monotonic()

            response = await wrapped(*args, **kwargs)

            try:
                response = process_embedding_response(
                    response=response,
                    gen_ai_endpoint="ollama.embeddings",
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
                        SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
                        server_address,
                        server_port,
                        request_model or "unknown",
                        "unknown",
                        environment,
                        application_name,
                        start_time,
                        time.monotonic(),
                        0,
                        0,
                        error_type=type(e).__name__ or "_OTHER",
                    )

        return response

    return wrapper
