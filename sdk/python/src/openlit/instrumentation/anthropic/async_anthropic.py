"""
Module for monitoring Anthropic API calls.
"""

import time
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port,
    record_completion_metrics,
    is_framework_llm_active,
)
from openlit.instrumentation.anthropic.utils import (
    process_chunk,
    process_chat_response,
    process_streaming_chat_response,
)
from openlit.semcov import SemanticConvention


def async_messages(
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
    Generates a telemetry wrapper for Anthropic AsyncMessages.create calls.
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
            event_provider=None,
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._span_name = span_name
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._input_tokens = 0
            self._output_tokens = 0
            self._cache_read_input_tokens = 0
            self._cache_creation_input_tokens = 0
            self._tool_arguments = ""
            self._tool_id = ""
            self._tool_name = ""
            self._tool_calls = None
            self._response_role = ""
            self._kwargs = kwargs
            self._start_time = time.time()
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
        Wraps the Anthropic AsyncMessages.create call.
        """

        if is_framework_llm_active():
            return await wrapped(*args, **kwargs)

        streaming = kwargs.get("stream", False)
        server_address, server_port = set_server_address_and_port(
            instance, "api.anthropic.com", 443
        )
        request_model = kwargs.get("model", "claude-3-5-sonnet-latest")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=no-else-return
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
                event_provider,
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
                            SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC,
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


def async_messages_stream(
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
    Generates a telemetry wrapper for Anthropic AsyncMessages.stream calls.
    """

    class TracedAsyncMessageStream:
        """
        Wrapper for Anthropic Async MessageStream to collect telemetry
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
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._span_name = span_name
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._input_tokens = 0
            self._output_tokens = 0
            self._cache_read_input_tokens = 0
            self._cache_creation_input_tokens = 0
            self._tool_arguments = ""
            self._tool_id = ""
            self._tool_name = ""
            self._tool_calls = None
            self._response_role = ""
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port
            self._event_provider = event_provider

        def __aiter__(self):
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped stream object."""
            if name == "text_stream":
                return self._instrumented_text_stream
            if name == "get_final_message":
                return self._instrumented_get_final_message
            if name == "until_done":
                return self._instrumented_until_done
            return getattr(self.__wrapped__, name)

        async def _instrumented_get_final_message(self):
            """Awaits stream completion via proxy then returns the final message."""
            async for _ in self:
                pass
            original_get_final_message = getattr(self.__wrapped__, "get_final_message")
            return await original_get_final_message()

        @property
        def _instrumented_text_stream(self):
            """Async generator that processes chunks through our proxy."""

            async def text_generator():
                async for event in self:
                    if (
                        hasattr(event, "delta")
                        and hasattr(event.delta, "type")
                        and event.delta.type == "text_delta"
                        and hasattr(event.delta, "text")
                    ):
                        yield event.delta.text

            return text_generator()

        async def _instrumented_until_done(self):
            """Ensures the async span is closed by draining the stream."""
            async for _ in self:
                pass

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

    class TracedAsyncMessageStreamManager:
        """
        Wrapper for Anthropic AsyncMessageStreamManager to instrument the 'async with' block.
        """

        def __init__(
            self,
            original_manager,
            span,
            span_name,
            kwargs,
            server_address,
            server_port,
            event_provider=None,
        ):
            self._original_manager = original_manager
            self._span = span
            self._span_name = span_name
            self._kwargs = kwargs
            self._server_address = server_address
            self._server_port = server_port
            self._event_provider = event_provider
            self._token = None

        async def __aenter__(self):
            """
            Attaches the span context and enters the original async stream manager.
            """
            ctx = trace_api.set_span_in_context(self._span)
            self._token = context_api.attach(ctx)

            stream = await self._original_manager.__aenter__()

            return TracedAsyncMessageStream(
                stream,
                self._span,
                self._span_name,
                self._kwargs,
                self._server_address,
                self._server_port,
                self._event_provider,
            )

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            """
            Detaches context and handles exceptions occurring inside the 'async with' block.
            """
            if self._token:
                context_api.detach(self._token)

            if exc_type:
                handle_exception(self._span, exc_val)
                if self._span.is_recording():
                    self._span.end()

            return await self._original_manager.__aexit__(exc_type, exc_val, exc_tb)

        def __getattr__(self, name):
            """Delegate attribute access to the original manager."""
            return getattr(self._original_manager, name)

    def wrapper(wrapped, instance, args, kwargs):
        """
        Intercepts the Anthropic async_messages.stream call to inject telemetry.
        """

        if is_framework_llm_active():
            return wrapped(*args, **kwargs)

        server_address, server_port = set_server_address_and_port(
            instance, "api.anthropic.com", 443
        )
        request_model = kwargs.get("model", "claude-3-5-sonnet-latest")
        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

        try:
            original_manager = wrapped(*args, **kwargs)
        except Exception as e:
            handle_exception(span, e)
            span.end()
            raise

        return TracedAsyncMessageStreamManager(
            original_manager,
            span,
            span_name,
            kwargs,
            server_address,
            server_port,
            event_provider,
        )

    return wrapper
