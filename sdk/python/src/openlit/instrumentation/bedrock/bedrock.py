"""
Module for monitoring Amazon Bedrock API calls.
"""

import time
from opentelemetry import trace as trace_api, context as context_api
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port,
    record_completion_metrics,
)
from openlit.instrumentation.bedrock.utils import (
    process_chunk,
    process_chat_response,
    process_streaming_chat_response,
)
from openlit.semcov import SemanticConvention


def converse(
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
    Generates a telemetry wrapper for AWS Bedrock converse calls.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the ClientCreator.create_client call.
        """

        def converse_wrapper(original_method, *method_args, **method_kwargs):
            """
            Wraps the individual converse method call.
            """

            server_address, server_port = set_server_address_and_port(
                instance, "aws.amazon.com", 443
            )
            request_model = method_kwargs.get("modelId", "amazon.titan-text-express-v1")

            span_name = (
                f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"
            )

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                start_time = time.time()
                response = original_method(*method_args, **method_kwargs)
                llm_config = method_kwargs.get("inferenceConfig", {})

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
                        llm_config=llm_config,
                        event_provider=event_provider,
                        **method_kwargs,
                    )

                except Exception as e:
                    handle_exception(span, e)
                    if not disable_metrics and metrics:
                        record_completion_metrics(
                            metrics,
                            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK,
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

        # Get the original client instance from the wrapper
        client = wrapped(*args, **kwargs)

        # Replace the original method with the instrumented one
        if kwargs.get("service_name") == "bedrock-runtime":
            original_invoke_model = client.converse
            client.converse = lambda *args, **kwargs: converse_wrapper(
                original_invoke_model, *args, **kwargs
            )

        return client

    return wrapper


def converse_stream(
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
    Generates a telemetry wrapper for AWS Bedrock converse_stream calls.
    """

    class TracedSyncStream:  # pylint: disable=too-many-instance-attributes
        """
        Wrapper for streaming responses to collect telemetry.
        """

        def __init__(
            self,
            wrapped_response,
            span,
            span_name,
            kwargs,
            server_address,
            server_port,
            event_provider=None,
            **args,
        ):
            self.__wrapped_response = wrapped_response
            # Keep the botocore EventStream intact. Its __iter__ is a generator
            # function, so calling iter() here would open a second generator
            # over the one-shot event body before the caller reads
            # response["stream"].
            if isinstance(wrapped_response, dict) and "stream" in wrapped_response:
                self._event_stream = wrapped_response["stream"]
            else:
                self._event_stream = wrapped_response
            self._iterator = None
            self._closed = False

            self._span = span
            self._span_name = span_name
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._finish_reason = ""
            self._tools = None
            self._tool_calls_by_index = {}
            self._input_tokens = 0
            self._output_tokens = 0
            self._cache_read_input_tokens = 0
            self._cache_creation_input_tokens = 0
            self._llm_config = kwargs.get("inferenceConfig", {})

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
            # The boto3 response dict is not a context manager. Callers that
            # use ``with client.converse_stream()`` are using this wrapper.
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            # A raise from user code is a cancel. A failure raised by the
            # event stream was stored on _stream_error in __next__.
            self.close()

        def __iter__(self):
            self._ensure_iterator()
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped response."""
            return getattr(self.__wrapped_response, name)

        def get(self, key, default=None):
            """Return this wrapper for ``stream``; delegate every other key.

            boto3 callers do ``for event in response["stream"]``. The raw
            EventStream under that key never enters __next__, so the span
            would stay open and the chunks would never be recorded.
            """
            if key == "stream":
                return self
            if isinstance(self.__wrapped_response, dict):
                return self.__wrapped_response.get(key, default)
            return getattr(self.__wrapped_response, key, default)

        def __getitem__(self, key):
            """Return this wrapper for ``stream``; delegate every other key."""
            if key == "stream":
                return self
            if isinstance(self.__wrapped_response, dict):
                return self.__wrapped_response[key]
            return getattr(self.__wrapped_response, key)

        def close(self):
            """Release the HTTP body and end the span once.

            ``EventStream.__iter__`` returns a generator. That generator's
            close() does not call ``EventStream.close()``, and
            ``StreamingBody.__del__`` does not close the socket.
            """
            try:
                self._close_body()
            finally:
                self._finalize_streaming_span(ended_cleanly=False)

        def __del__(self):
            """End a span abandoned by a bare ``for`` loop.

            ``break`` does not call close() on this iterator. Nothing else
            closes the botocore stream, so dropping the response has to.
            """
            try:
                self.close()
            except Exception:
                pass

        def _ensure_iterator(self):
            if self._iterator is None:
                self._iterator = iter(self._event_stream)
            return self._iterator

        def _close_body(self):
            if self._closed:
                return
            self._closed = True
            iterator = self._iterator
            event_stream = self._event_stream
            # The generator and the EventStream are different objects.
            # Closing only the generator leaves the HTTP connection open.
            if iterator is not None and iterator is not event_stream:
                iterator_close = getattr(iterator, "close", None)
                if iterator_close is not None:
                    try:
                        iterator_close()
                    except Exception:
                        pass
            stream_close = getattr(event_stream, "close", None)
            if stream_close is not None:
                try:
                    stream_close()
                except Exception:
                    pass

        def __next__(self):
            try:
                chunk = next(self._ensure_iterator())
            except StopIteration:
                self._finalize_streaming_span(ended_cleanly=True)
                self._close_body()
                raise
            except Exception as exc:
                self._stream_error = exc
                raise
            process_chunk(self, chunk)
            return chunk

        def _finalize_streaming_span(self, ended_cleanly):
            """End the span once.

            ``ended_cleanly`` is True only for StopIteration. An empty finish
            reason is otherwise a cancel. A failure raised by the event stream
            is recorded after attributes are set, so partial text stays on the
            span and the status is ERROR rather than the OK that
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

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the ClientCreator.create_client call.
        """

        def converse_stream_wrapper(original_method, *method_args, **method_kwargs):
            """
            Wraps the individual converse_stream method call.
            """

            server_address, server_port = set_server_address_and_port(
                instance, "aws.amazon.com", 443
            )
            request_model = method_kwargs.get("modelId", "amazon.titan-text-express-v1")

            span_name = (
                f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"
            )

            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            ctx = trace_api.set_span_in_context(span)
            token = context_api.attach(ctx)
            try:
                stream_response = original_method(*method_args, **method_kwargs)
            except Exception as e:
                handle_exception(span, e)
                context_api.detach(token)
                span.end()
                raise
            context_api.detach(token)

            return TracedSyncStream(
                stream_response,
                span,
                span_name,
                method_kwargs,
                server_address,
                server_port,
                event_provider=event_provider,
            )

        # Get the original client instance from the wrapper
        client = wrapped(*args, **kwargs)

        # Replace the original method with the instrumented one
        if kwargs.get("service_name") == "bedrock-runtime":
            original_stream_model = client.converse_stream
            client.converse_stream = lambda *args, **kwargs: converse_stream_wrapper(
                original_stream_model, *args, **kwargs
            )

        return client

    return wrapper
