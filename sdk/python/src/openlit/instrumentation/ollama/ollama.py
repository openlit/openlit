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
from openlit.semcov import SemanticConvetion

logger = logging.getLogger(__name__)

def chat(version, environment, application_name,
            tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    class TracedSyncStream:
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

        def __enter__(self):
            self.__wrapped__.__enter__()
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            self.__wrapped__.__exit__(exc_type, exc_value, traceback)

        def __iter__(self):
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(self.__wrapped__, name)

        def __next__(self):
            try:
                chunk = self.__wrapped__.__next__()
                process_chunk(self, chunk)
                return chunk
            except StopIteration:
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

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        streaming = kwargs.get("stream", False)

        server_address, server_port = set_server_address_and_port(instance, "127.0.0.1", 11434)
        request_model = kwargs.get("model", "gpt-4o")

        span_name = f"{SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=no-else-return
        if streaming:
            awaited_wrapped = wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            return TracedSyncStream(awaited_wrapped, span, span_name, kwargs, server_address, server_port)

        else:
            with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
                start_time = time.time()
                response = wrapped(*args, **kwargs)
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

def embeddings(version, environment, application_name,
              tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = set_server_address_and_port(instance, '127.0.0.1', 11434)
        request_model = kwargs.get('model', 'all-minilm')

        span_name = f'{SemanticConvetion.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}'

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
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
