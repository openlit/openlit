"""
Module for monitoring LiteLLM API calls.
"""

import inspect
import time
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    record_completion_metrics,
    record_embedding_metrics,
    is_litellm_span_active,
    set_litellm_span_active,
    reset_litellm_span_active,
    set_framework_llm_active,
    reset_framework_llm_active,
)
from openlit.instrumentation.litellm.utils import (
    get_litellm_server_address,
    process_chunk,
    process_streaming_chat_response,
    process_chat_response,
    process_embedding_response,
)
from openlit.semcov import SemanticConvention


def completion(
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

    class TracedSyncStream:  # pylint: disable=too-many-instance-attributes
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
            self._streaming_response_processed = False
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._response_service_tier = ""
            self._response_system_fingerprint = ""
            self._tools = None
            self._input_tokens = 0
            self._output_tokens = 0
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
            self._stream_error = None

        def __enter__(self):
            # CustomStreamWrapper.__enter__(self) -> CustomStreamWrapper exists
            # only on unreleased 1.107. Releases through 1.105.1 are iterators.
            enter = getattr(self.__wrapped__, "__enter__", None)
            if enter is not None:
                enter()
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            # 1.107 defines __exit__(self, *exc_info) -> None as self.close().
            # Older releases have no __exit__; close() finalizes on its own.
            exit_fn = getattr(self.__wrapped__, "__exit__", None)
            if exit_fn is None:
                self.close()
                return None
            try:
                return exit_fn(exc_type, exc_value, traceback)
            except BaseException as exit_exc:
                if self._stream_error is None:
                    self._stream_error = exit_exc
                raise
            finally:
                self._finalize_streaming_span(ended_cleanly=False)

        def __iter__(self):
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(self.__wrapped__, name)

        def __del__(self):
            """Finalize a span abandoned by a bare ``for`` loop.

            CustomStreamWrapper is a class iterator, so ``break`` calls neither
            ``close()`` nor ``__exit__``. Releases through 1.105.1 have neither
            method. Dealloc only ends the span; HTTP cleanup stays with LiteLLM.
            """
            try:
                self._finalize_streaming_span(ended_cleanly=False)
            except Exception:
                pass

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

        def close(self):
            """Call ``CustomStreamWrapper.close(self) -> None`` and finalize.

            That method is synchronous and ships on 1.107. Releases through
            1.105.1 have no ``close``; the span is still finalized.
            """
            try:
                closer = getattr(self.__wrapped__, "close", None)
                if closer is not None:
                    try:
                        result = closer()
                        # close() returns None. Drop a coroutine from a
                        # mismatched object so it cannot warn "never awaited".
                        if inspect.iscoroutine(result):
                            result.close()
                    except BaseException as exit_exc:
                        if self._stream_error is None:
                            self._stream_error = exit_exc
                        raise
            finally:
                self._finalize_streaming_span(ended_cleanly=False)

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """
        if is_litellm_span_active():
            return wrapped(*args, **kwargs)

        litellm_token = set_litellm_span_active()
        try:
            streaming = kwargs.get("stream", False)
            server_address, server_port = get_litellm_server_address(instance, kwargs)
            request_model = kwargs.get("model", "openai/gpt-4o")

            span_name = (
                f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"
            )

            if streaming:
                span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
                ctx = trace_api.set_span_in_context(span)
                otel_token = context_api.attach(ctx)
                fw_token = set_framework_llm_active()
                try:
                    awaited_wrapped = wrapped(*args, **kwargs)
                except Exception as e:
                    handle_exception(span, e)
                    context_api.detach(otel_token)
                    span.end()
                    raise
                finally:
                    reset_framework_llm_active(fw_token)
                context_api.detach(otel_token)
                return TracedSyncStream(
                    awaited_wrapped,
                    span,
                    span_name,
                    kwargs,
                    server_address,
                    server_port,
                    event_provider=event_provider,
                )
            else:
                with tracer.start_as_current_span(
                    span_name, kind=SpanKind.CLIENT
                ) as span:
                    start_time = time.time()
                    fw_token = set_framework_llm_active()
                    try:
                        response = wrapped(*args, **kwargs)
                    finally:
                        reset_framework_llm_active(fw_token)

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
                                SemanticConvention.GEN_AI_SYSTEM_LITELLM,
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
        finally:
            reset_litellm_span_active(litellm_token)

    return wrapper


def embedding(
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

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI embedding function call.
        """
        if is_litellm_span_active():
            return wrapped(*args, **kwargs)

        litellm_token = set_litellm_span_active()
        try:
            server_address, server_port = get_litellm_server_address(instance, kwargs)
            request_model = kwargs.get("model", "text-embedding-ada-002")

            span_name = (
                f"{SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}"
            )

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                fw_token = set_framework_llm_active()
                try:
                    response = wrapped(*args, **kwargs)
                finally:
                    reset_framework_llm_active(fw_token)

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
                            SemanticConvention.GEN_AI_SYSTEM_LITELLM,
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
        finally:
            reset_litellm_span_active(litellm_token)

    return wrapper
