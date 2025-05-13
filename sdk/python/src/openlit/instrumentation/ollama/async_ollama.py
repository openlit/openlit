"""
Module for monitoring Ollama API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port
)
from openlit.instrumentation.ollama.utils import (
    process_chunk,
    process_chat_response,
    process_streaming_chat_response,
    process_embedding_response
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)

def async_chat(version, environment, application_name,
            tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
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
                **args,
            ):
            self.__wrapped__ = wrapped
            self._span = span
            self._llmresponse = ""
            self._response_model = ""
            self._finish_reason = ""
            self._tool_calls = []
            self._input_tokens = 0
            self._output_tokens = 0
            self._response_role = ''
            self._span_name = span_name
            self._args = args
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port

        async def __aenter__(self):
            await self.__wrapped__.__aenter__()
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            await self.__wrapped__.__aexit__(exc_type, exc_value, traceback)

        def __aiter__(self):
            return self

        async def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(await self.__wrapped__, name)

        async def __anext__(self):
            try:
                chunk = await self.__wrapped__.__anext__()
                process_chunk(self, chunk)
                return chunk
            except StopAsyncIteration:
                try:
                    with tracer.start_as_current_span(self._span_name, kind= SpanKind.CLIENT) as self._span:
                        process_streaming_chat_response(
                            self,
                            pricing_info=pricing_info,
                            environment=environment,
                            application_name=application_name,
                            metrics=metrics,
                            event_provider=event_provider,
                            capture_message_content=capture_message_content,
                            disable_metrics=disable_metrics,
                            version=version
                        )
                except Exception as e:
                    handle_exception(self._span, e)
                    logger.error("Error in trace creation: %s", e)
                raise

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        streaming = kwargs.get("stream", False)

        server_address, server_port = set_server_address_and_port(instance, "127.0.0.1", 11434)
        json_body = kwargs.get("json", {}) or {}
        request_model = json_body.get("model") or kwargs.get("model")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=no-else-return
        if streaming:
            awaited_wrapped = await wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            return TracedAsyncStream(awaited_wrapped, span, span_name, kwargs, server_address, server_port)

        else:
            with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
                start_time = time.time()
                response = await wrapped(*args, **kwargs)
                response = process_chat_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    event_provider=event_provider,
                    start_time=start_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    **kwargs
                )

            return response

    return wrapper

def async_embeddings(version, environment, application_name,
              tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = set_server_address_and_port(instance, '127.0.0.1', 11434)
        json_body = kwargs.get('json', {}) or {}
        request_model = json_body.get('model') or kwargs.get('model')

        span_name = f'{SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}'

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = await wrapped(*args, **kwargs)
            response = process_embedding_response(
                response=response,
                request_model=request_model,
                pricing_info=pricing_info,
                server_port=server_port,
                server_address=server_address,
                environment=environment,
                application_name=application_name,
                metrics=metrics,
                event_provider=event_provider,
                start_time=start_time,
                span=span,
                capture_message_content=capture_message_content,
                disable_metrics=disable_metrics,
                version=version,
                **kwargs
            )

        return response

    return wrapper
