"""
Module for monitoring Groq API calls (async version).
"""

import time
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port
)
from openlit.semcov import SemanticConvention
from openlit.instrumentation.groq.utils import (
    process_chunk,
    process_streaming_chat_response,
    process_chat_response
)

def async_chat(version, environment, application_name, tracer, pricing_info, 
               capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    class TracedAsyncStream:
        """
        Wrapper for async streaming responses to collect telemetry.
        """
        def __init__(self, wrapped, span, kwargs, server_address, server_port, args):
            self.__wrapped__ = wrapped
            self._span = span
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._system_fingerprint = ""
            self._input_tokens = 0
            self._output_tokens = 0
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
                # Process completion when streaming ends
                process_streaming_chat_response(
                    self, pricing_info, environment, application_name,
                    metrics, capture_message_content, disable_metrics, version
                )
                raise

    async def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """
        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)
        server_address, server_port = set_server_address_and_port(instance, "api.groq.com", 443)
        request_model = kwargs.get("model", "mixtral-8x7b-32768")
        
        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        if streaming:
            # Special handling for streaming response
            awaited_wrapped = await wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            return TracedAsyncStream(awaited_wrapped, span, kwargs, server_address, server_port, args)
        else:
            # Handling for non-streaming responses
            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                response = await wrapped(*args, **kwargs)
                
                return process_chat_response(
                    response, request_model, pricing_info, server_port, server_address,
                    environment, application_name, metrics, start_time, span,
                    capture_message_content, disable_metrics, version, **kwargs
                )

    return wrapper
