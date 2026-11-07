"""
Module for monitoring Google AI Studio API calls.
"""

import time
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port,
    record_completion_metrics,
    safe_detach,
)
from openlit.instrumentation.google_ai_studio.utils import (
    process_chat_response,
    process_chunk,
    process_streaming_chat_response,
)
from openlit.semcov import SemanticConvention


def generate(
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

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "generativelanguage.googleapis.com", 443
        )
        request_model = kwargs.get("model", "gemini-2.0-flash")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                if not disable_metrics and metrics:
                    try:
                        record_completion_metrics(
                            metrics,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            SemanticConvention.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO,
                            server_address, server_port, request_model,
                            "unknown", environment, application_name,
                            start_time, time.time(),
                            0, 0, 0, None, None,
                            error_type=type(e).__name__ or "_OTHER",
                        )
                    except Exception:
                        pass
                raise

            try:
                response = process_chat_response(
                    instance=instance,
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
                    args=args,
                    kwargs=kwargs,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                )

            except Exception as e:
                handle_exception(span, e)
                if not disable_metrics and metrics:
                    record_completion_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        SemanticConvention.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO,
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

            # Return original response
            return response

    return wrapper


def generate_stream(
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
            event_provider=None,
            **args,
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._span_name = span_name
            self._llmresponse = ""
            self._finish_reason = ""
            self._response_id = ""
            self._input_tokens = 0
            self._output_tokens = 0
            self._reasoning_tokens = 0
            self._cache_read_input_tokens = 0
            self._cache_creation_input_tokens = 0
            self._response_model = ""
            self._tools = None

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

        def __enter__(self):
            # Models.generate_content_stream yields. Generators have no __enter__.
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            self.close()

        def __iter__(self):
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(self.__wrapped__, name)

        def close(self):
            """Close the wrapped generator and finalize the span if it has not ended yet."""
            try:
                self.__wrapped__.close()
            finally:
                self._finalize_streaming_span(ended_cleanly=False)

        def __del__(self):
            """Finalize a span abandoned by a bare ``for`` loop.

            The wrapper is the iterator, so ``break`` never calls ``close()``.
            The wrapped generator's dealloc still closes the RPC stream.
            """
            try:
                self._finalize_streaming_span(ended_cleanly=False)
            except Exception:
                pass

        def _finalize_streaming_span(self, ended_cleanly):
            """End the span once.

            ``ended_cleanly`` is True only for StopIteration. An empty finish
            reason is otherwise a cancel. A failure raised by the wrapped
            stream is recorded after attributes are set, so partial text stays
            on the span and the status is ERROR rather than the OK that
            ``process_streaming_chat_response`` writes when nothing failed.
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
                            event_provider=self._event_provider,
                        )
                    finally:
                        if self._stream_error is not None:
                            handle_exception(self._span, self._stream_error)
            except Exception as e:
                handle_exception(self._span, e)

        def __next__(self):
            try:
                chunk = self.__wrapped__.__next__()
                process_chunk(self, chunk)
                return chunk
            except StopIteration:
                self._finalize_streaming_span(ended_cleanly=True)
                raise
            except Exception as exc:
                self._stream_error = exc
                raise

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "generativelanguage.googleapis.com", 443
        )
        request_model = kwargs.get("model", "gemini-2.0-flash")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
        ctx = trace_api.set_span_in_context(span)
        token = context_api.attach(ctx)
        start_time = time.time()
        try:
            awaited_wrapped = wrapped(*args, **kwargs)
        except Exception as e:
            handle_exception(span, e)
            if not disable_metrics and metrics:
                try:
                    record_completion_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        SemanticConvention.GEN_AI_SYSTEM_GOOGLE_AI_STUDIO,
                        server_address, server_port, request_model,
                        "unknown", environment, application_name,
                        start_time, time.time(),
                        0, 0, 0, None, None,
                        error_type=type(e).__name__ or "_OTHER",
                        is_stream=True,
                    )
                except Exception:
                    pass
            safe_detach(token)
            span.end()
            raise
        safe_detach(token)

        return TracedSyncStream(
            awaited_wrapped,
            span,
            span_name,
            kwargs,
            server_address,
            server_port,
            event_provider,
        )

    return wrapper
