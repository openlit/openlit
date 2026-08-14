"""
Module for monitoring OpenAI API calls.
"""

import time
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port,
    record_completion_metrics,
    record_embedding_metrics,
    is_framework_llm_active,
)
from openlit.instrumentation.openai.utils import (
    process_chat_chunk,
    process_response_chunk,
    process_chat_response,
    process_streaming_chat_response,
    process_streaming_response_response,
    process_response_response,
    process_embedding_response,
    process_image_response,
    process_audio_response,
    process_transcription_response,
    process_moderation_response,
    process_lightweight_response,
    set_openai_request_span_attributes,
    set_span_error_type,
)
from openlit.semcov import SemanticConvention


def chat_completions(
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
    Generates a telemetry wrapper for OpenAI chat completions.
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
        ):
            self.__wrapped__ = wrapped
            self._span = span
            self._span_name = span_name
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._system_fingerprint = ""
            self._service_tier = "auto"
            self._tools = None
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port
            self._event_provider = event_provider

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
                process_chat_chunk(self, chunk)
                return chunk
            except StopIteration:
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

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OpenAI chat completions call.
        """

        if is_framework_llm_active():
            return wrapped(*args, **kwargs)

        streaming = kwargs.get("stream", False)
        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "gpt-4o")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        if streaming:
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                True,
                version,
            )
            ctx = trace_api.set_span_in_context(span)
            token = context_api.attach(ctx)
            try:
                awaited_wrapped = wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                context_api.detach(token)
                span.end()
                raise
            context_api.detach(token)

            return TracedSyncStream(
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
                set_openai_request_span_attributes(
                    span,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    server_address,
                    server_port,
                    request_model,
                    environment,
                    application_name,
                    False,
                    version,
                )
                try:
                    response = wrapped(*args, **kwargs)
                except Exception as e:
                    err_type = set_span_error_type(span, e)
                    if not disable_metrics and metrics:
                        record_completion_metrics(
                            metrics,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                            server_address,
                            server_port,
                            request_model,
                            kwargs.get("model", "unknown"),
                            environment,
                            application_name,
                            start_time,
                            time.time(),
                            0,
                            0,
                            0,
                            None,
                            None,
                            error_type=err_type,
                        )
                    raise

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
                        err_type = type(e).__name__ or "_OTHER"
                        record_completion_metrics(
                            metrics,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                            server_address,
                            server_port,
                            request_model,
                            kwargs.get("model", "unknown"),
                            environment,
                            application_name,
                            start_time,
                            time.time(),
                            0,
                            0,
                            0,
                            None,
                            None,
                            error_type=err_type,
                        )

                return response

    return wrapper


def responses(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
    **kwargs,
):
    """
    Generates a telemetry wrapper for OpenAI responses API.
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
            self._reasoning_tokens = 0
            self._operation_type = "responses"
            self._service_tier = "default"
            self._tools = None
            self._response_tools = None
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port
            self._event_provider = event_provider

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
                process_response_chunk(self, chunk)
                return chunk
            except StopIteration:
                try:
                    with self._span:
                        process_streaming_response_response(
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

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OpenAI responses API call.
        """

        streaming = kwargs.get("stream", False)
        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "gpt-4o")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        if streaming:
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                True,
                version,
            )
            ctx = trace_api.set_span_in_context(span)
            token = context_api.attach(ctx)
            try:
                awaited_wrapped = wrapped(*args, **kwargs)
            except Exception as e:
                handle_exception(span, e)
                context_api.detach(token)
                span.end()
                raise
            context_api.detach(token)

            return TracedSyncStream(
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
                set_openai_request_span_attributes(
                    span,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    server_address,
                    server_port,
                    request_model,
                    environment,
                    application_name,
                    False,
                    version,
                )
                try:
                    response = wrapped(*args, **kwargs)
                except Exception as e:
                    err_type = set_span_error_type(span, e)
                    if not disable_metrics and metrics:
                        record_completion_metrics(
                            metrics,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                            server_address,
                            server_port,
                            request_model,
                            kwargs.get("model", "unknown"),
                            environment,
                            application_name,
                            start_time,
                            time.time(),
                            0,
                            0,
                            0,
                            None,
                            None,
                            error_type=err_type,
                        )
                    raise

                try:
                    response = process_response_response(
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
                        err_type = type(e).__name__ or "_OTHER"
                        record_completion_metrics(
                            metrics,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                            server_address,
                            server_port,
                            request_model,
                            kwargs.get("model", "unknown"),
                            environment,
                            application_name,
                            start_time,
                            time.time(),
                            0,
                            0,
                            0,
                            None,
                            None,
                            error_type=err_type,
                        )

                return response

    return wrapper


def chat_completions_parse(
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
    Generates a telemetry wrapper for OpenAI chat completions parse.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OpenAI chat completions parse call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "gpt-4o")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                err_type = set_span_error_type(span, e)
                if not disable_metrics and metrics:
                    record_completion_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
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
                        error_type=err_type,
                    )
                raise

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
                        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
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
    **kwargs,
):
    """
    Generates a telemetry wrapper for OpenAI embeddings.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OpenAI embeddings call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "text-embedding-ada-002")

        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                err_type = set_span_error_type(span, e)
                if not disable_metrics and metrics:
                    record_embedding_metrics(
                        metrics,
                        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
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
                        error_type=err_type,
                    )
                raise

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
                        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
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


def image_generate(
    version,
    environment,
    application_name,
    tracer,
    pricing_info,
    capture_message_content,
    metrics,
    disable_metrics,
    event_provider=None,
    **kwargs,
):
    """
    Generates a telemetry wrapper for OpenAI image generation.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OpenAI image generation call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "dall-e-2")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                set_span_error_type(span, e)
                raise
            end_time = time.time()

            try:
                response = process_image_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    end_time=end_time,
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
                        SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                        server_address,
                        server_port,
                        request_model,
                        "unknown",
                        environment,
                        application_name,
                        start_time,
                        end_time,
                        0,
                        0,
                        0,
                        None,
                        None,
                        error_type=type(e).__name__ or "_OTHER",
                    )

            return response

    return wrapper


def image_variatons(
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
    Generates a telemetry wrapper for OpenAI image variations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OpenAI image variations call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "dall-e-2")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                set_span_error_type(span, e)
                raise
            end_time = time.time()

            try:
                response = process_image_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    end_time=end_time,
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
                        SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                        server_address,
                        server_port,
                        request_model,
                        "unknown",
                        environment,
                        application_name,
                        start_time,
                        end_time,
                        0,
                        0,
                        0,
                        None,
                        None,
                        error_type=type(e).__name__ or "_OTHER",
                    )

            return response

    return wrapper


def audio_create(
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
    Generates a telemetry wrapper for OpenAI audio creation.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the OpenAI audio creation call.
        """

        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "tts-1")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                set_span_error_type(span, e)
                raise
            end_time = time.time()

            try:
                response = process_audio_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    end_time=end_time,
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
                        SemanticConvention.GEN_AI_OPERATION_TYPE_AUDIO,
                        SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                        server_address,
                        server_port,
                        request_model,
                        "unknown",
                        environment,
                        application_name,
                        start_time,
                        end_time,
                        0,
                        0,
                        0,
                        None,
                        None,
                        error_type=type(e).__name__ or "_OTHER",
                    )

            return response

    return wrapper


def audio_transcription(
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
    Generates a telemetry wrapper for OpenAI audio transcription.
    """

    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "whisper-1")

        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_SPEECH_TO_TEXT} {request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_SPEECH_TO_TEXT,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                set_span_error_type(span, e)
                raise
            end_time = time.time()

            try:
                response = process_transcription_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    end_time=end_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                    **kwargs,
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper


def audio_translation(
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
    Generates a telemetry wrapper for OpenAI audio translation.
    """

    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "whisper-1")

        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_SPEECH_TO_TEXT} {request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_SPEECH_TO_TEXT,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                set_span_error_type(span, e)
                raise
            end_time = time.time()

            try:
                response = process_transcription_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    end_time=end_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                    **kwargs,
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper


def image_edit(
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
    Generates a telemetry wrapper for OpenAI image editing.
    """

    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "gpt-image-1")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE} {request_model}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                set_span_error_type(span, e)
                raise
            end_time = time.time()

            try:
                response = process_image_response(
                    response=response,
                    request_model=request_model,
                    pricing_info=pricing_info,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    end_time=end_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                    **kwargs,
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper


def moderation(
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
    Generates a telemetry wrapper for OpenAI moderation.
    """

    def wrapper(wrapped, instance, args, kwargs):
        server_address, server_port = set_server_address_and_port(
            instance, "api.openai.com", 443
        )
        request_model = kwargs.get("model", "omni-moderation-latest")

        span_name = (
            f"{SemanticConvention.GEN_AI_OPERATION_TYPE_MODERATION} {request_model}"
        )

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            start_time = time.time()
            set_openai_request_span_attributes(
                span,
                SemanticConvention.GEN_AI_OPERATION_TYPE_MODERATION,
                server_address,
                server_port,
                request_model,
                environment,
                application_name,
                False,
                version,
            )
            try:
                response = wrapped(*args, **kwargs)
            except Exception as e:
                set_span_error_type(span, e)
                raise
            end_time = time.time()

            try:
                response = process_moderation_response(
                    response=response,
                    request_model=request_model,
                    server_port=server_port,
                    server_address=server_address,
                    environment=environment,
                    application_name=application_name,
                    metrics=metrics,
                    start_time=start_time,
                    end_time=end_time,
                    span=span,
                    capture_message_content=capture_message_content,
                    disable_metrics=disable_metrics,
                    version=version,
                    event_provider=event_provider,
                    **kwargs,
                )

            except Exception as e:
                handle_exception(span, e)

            return response

    return wrapper


def _make_lightweight_wrapper(span_prefix, operation_type, default_model="unknown"):
    """Factory for creating lightweight sync wrappers for infrastructure APIs."""

    def outer(
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
        def wrapper(wrapped, instance, args, kwargs):
            server_address, server_port = set_server_address_and_port(
                instance, "api.openai.com", 443
            )
            request_model = kwargs.get("model", default_model)
            span_name = f"{span_prefix} {request_model}"

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                set_openai_request_span_attributes(
                    span,
                    operation_type,
                    server_address,
                    server_port,
                    request_model,
                    environment,
                    application_name,
                    False,
                    version,
                )
                try:
                    response = wrapped(*args, **kwargs)
                except Exception as e:
                    set_span_error_type(span, e)
                    raise
                end_time = time.time()

                try:
                    response = process_lightweight_response(
                        response=response,
                        operation_type=operation_type,
                        request_model=request_model,
                        server_port=server_port,
                        server_address=server_address,
                        environment=environment,
                        application_name=application_name,
                        metrics=metrics,
                        start_time=start_time,
                        end_time=end_time,
                        span=span,
                        disable_metrics=disable_metrics,
                        version=version,
                        **kwargs,
                    )
                except Exception as e:
                    handle_exception(span, e)

                return response

        return wrapper

    return outer


# Responses API extras
responses_retrieve = _make_lightweight_wrapper(
    "responses.retrieve", SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, "gpt-4o"
)
responses_cancel = _make_lightweight_wrapper(
    "responses.cancel", SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, "gpt-4o"
)
responses_token_count = _make_lightweight_wrapper(
    "responses.token_count", SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, "gpt-4o"
)

# Chat messages
chat_messages_list = _make_lightweight_wrapper(
    "chat.messages.list", SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT, "gpt-4o"
)

# Batch
batch_create = _make_lightweight_wrapper(
    "batch.create", SemanticConvention.GEN_AI_OPERATION_TYPE_BATCH
)
batch_retrieve = _make_lightweight_wrapper(
    "batch.retrieve", SemanticConvention.GEN_AI_OPERATION_TYPE_BATCH
)
batch_list = _make_lightweight_wrapper(
    "batch.list", SemanticConvention.GEN_AI_OPERATION_TYPE_BATCH
)
batch_cancel = _make_lightweight_wrapper(
    "batch.cancel", SemanticConvention.GEN_AI_OPERATION_TYPE_BATCH
)

# Fine-tuning
fine_tuning_create = _make_lightweight_wrapper(
    "fine_tuning.create", SemanticConvention.GEN_AI_OPERATION_TYPE_FINE_TUNING
)
fine_tuning_retrieve = _make_lightweight_wrapper(
    "fine_tuning.retrieve", SemanticConvention.GEN_AI_OPERATION_TYPE_FINE_TUNING
)
fine_tuning_list = _make_lightweight_wrapper(
    "fine_tuning.list", SemanticConvention.GEN_AI_OPERATION_TYPE_FINE_TUNING
)
fine_tuning_cancel = _make_lightweight_wrapper(
    "fine_tuning.cancel", SemanticConvention.GEN_AI_OPERATION_TYPE_FINE_TUNING
)

# Vector stores
vector_store_create = _make_lightweight_wrapper(
    "vector_store.create", SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB
)
vector_store_retrieve = _make_lightweight_wrapper(
    "vector_store.retrieve", SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB
)
vector_store_update = _make_lightweight_wrapper(
    "vector_store.update", SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB
)
vector_store_delete = _make_lightweight_wrapper(
    "vector_store.delete", SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB
)
vector_store_list = _make_lightweight_wrapper(
    "vector_store.list", SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB
)
vector_store_search = _make_lightweight_wrapper(
    "vector_store.search", SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB
)

# Files
file_create = _make_lightweight_wrapper(
    "file.create", SemanticConvention.GEN_AI_OPERATION_TYPE_FILE
)
file_retrieve = _make_lightweight_wrapper(
    "file.retrieve", SemanticConvention.GEN_AI_OPERATION_TYPE_FILE
)
file_delete = _make_lightweight_wrapper(
    "file.delete", SemanticConvention.GEN_AI_OPERATION_TYPE_FILE
)
file_content = _make_lightweight_wrapper(
    "file.content", SemanticConvention.GEN_AI_OPERATION_TYPE_FILE
)

# Video
video_create = _make_lightweight_wrapper(
    "video.create", SemanticConvention.GEN_AI_OPERATION_TYPE_VIDEO, "sora-2"
)
video_retrieve = _make_lightweight_wrapper(
    "video.retrieve", SemanticConvention.GEN_AI_OPERATION_TYPE_VIDEO, "sora-2"
)
video_list = _make_lightweight_wrapper(
    "video.list", SemanticConvention.GEN_AI_OPERATION_TYPE_VIDEO, "sora-2"
)
video_delete = _make_lightweight_wrapper(
    "video.delete", SemanticConvention.GEN_AI_OPERATION_TYPE_VIDEO, "sora-2"
)
video_edit_op = _make_lightweight_wrapper(
    "video.edit", SemanticConvention.GEN_AI_OPERATION_TYPE_VIDEO, "sora-2"
)
video_extend = _make_lightweight_wrapper(
    "video.extend", SemanticConvention.GEN_AI_OPERATION_TYPE_VIDEO, "sora-2"
)
video_remix = _make_lightweight_wrapper(
    "video.remix", SemanticConvention.GEN_AI_OPERATION_TYPE_VIDEO, "sora-2"
)

# Conversations
conversation_create = _make_lightweight_wrapper(
    "conversation.create", SemanticConvention.GEN_AI_OPERATION_TYPE_CONVERSATION
)
conversation_retrieve = _make_lightweight_wrapper(
    "conversation.retrieve", SemanticConvention.GEN_AI_OPERATION_TYPE_CONVERSATION
)
conversation_update = _make_lightweight_wrapper(
    "conversation.update", SemanticConvention.GEN_AI_OPERATION_TYPE_CONVERSATION
)
conversation_delete = _make_lightweight_wrapper(
    "conversation.delete", SemanticConvention.GEN_AI_OPERATION_TYPE_CONVERSATION
)
conversation_item_create = _make_lightweight_wrapper(
    "conversation.item.create", SemanticConvention.GEN_AI_OPERATION_TYPE_CONVERSATION
)
conversation_item_list = _make_lightweight_wrapper(
    "conversation.item.list", SemanticConvention.GEN_AI_OPERATION_TYPE_CONVERSATION
)
conversation_item_retrieve = _make_lightweight_wrapper(
    "conversation.item.retrieve", SemanticConvention.GEN_AI_OPERATION_TYPE_CONVERSATION
)
conversation_item_delete = _make_lightweight_wrapper(
    "conversation.item.delete", SemanticConvention.GEN_AI_OPERATION_TYPE_CONVERSATION
)

# Realtime
realtime_session_create = _make_lightweight_wrapper(
    "realtime.session",
    SemanticConvention.GEN_AI_OPERATION_TYPE_REALTIME,
    "gpt-4o-realtime-preview",
)
