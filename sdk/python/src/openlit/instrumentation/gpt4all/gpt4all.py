"""
Module for monitoring GPT4All API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    handle_exception,
    general_tokens,
    create_metrics_attributes,
    set_server_address_and_port,
    calculate_tbt,
    calculate_ttft
)
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def generate(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the GPT4All API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating GPT4All usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    class TracedSyncStream:
        """
        Wrapper for streaming responses to collect metrics and trace data.
        Wraps the response to collect message IDs and aggregated response.

        This class implements the '__aiter__' and '__anext__' methods that
        handle asynchronous streaming responses.

        This class also implements '__aenter__' and '__aexit__' methods that
        handle asynchronous context management protocol.
        """
        def __init__(
                self,
                wrapped,
                span,
                kwargs,
                server_address,
                server_port,
                request_model,
                **args,
            ):
            self.__wrapped__ = wrapped
            self._span = span
            # Placeholder for aggregating streaming response
            self._llmresponse = ""

            self._args = args
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port
            self._request_model = request_model

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
                end_time = time.time()
                # Record the timestamp for the current chunk
                self._timestamps.append(end_time)

                if len(self._timestamps) == 1:
                    # Calculate time to first chunk
                    self._ttft = calculate_ttft(self._timestamps, self._start_time)

                self._llmresponse += chunk
                return chunk
            except StopIteration:
                # Handling exception ensure LLM observability without disrupting operation
                try:
                    self._end_time = time.time()

                    if len(self._timestamps) > 1:
                        self._tbt = calculate_tbt(self._timestamps)

                    prompt = self._kwargs.get("prompt") or self._args[0] or ""

                    # Calculate tokens using input prompt and aggregated response
                    input_tokens = general_tokens(prompt)
                    output_tokens = general_tokens(self._llmresponse)

                    # Set Span attributes (OTel Semconv)
                    self._span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    self._span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_GPT4ALL)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        self._request_model)
                    self._span.set_attribute(SemanticConvention.SERVER_PORT,
                                        self._server_port)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                        self._kwargs.get("repeat_penalty", 1.18))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
                                        self._kwargs.get("max_tokens", 200))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                        self._kwargs.get("presence_penalty", 0.0))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                        self._kwargs.get("temp", 0.7))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                        self._kwargs.get("top_p", 0.4))
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_K,
                                        self._kwargs.get("top_k", 40))
                    self._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        self._request_model)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                        input_tokens)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                        output_tokens)
                    self._span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        self._server_address)
                    if isinstance(self._llmresponse, str):
                        self._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "text")
                    else:
                        self._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "json")

                    # Set Span attributes (Extra)
                    self._span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    self._span.set_attribute(SERVICE_NAME,
                                        application_name)
                    self._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                                        True)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                        input_tokens + output_tokens)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TBT,
                                        self._tbt)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                                        self._ttft)
                    self._span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)
                    self._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                        0)
                    if capture_message_content:
                        self._span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        self._span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION: self._llmresponse,
                            },
                        )

                    self._span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = create_metrics_attributes(
                            service_name=application_name,
                            deployment_environment=environment,
                            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            system=SemanticConvention.GEN_AI_SYSTEM_GPT4ALL,
                            request_model=self._request_model,
                            server_address=self._server_address,
                            server_port=self._server_port,
                            response_model=self._request_model,
                        )

                        metrics["genai_client_usage_tokens"].record(
                            input_tokens + output_tokens, attributes
                        )
                        metrics["genai_client_operation_duration"].record(
                            self._end_time - self._start_time, attributes
                        )
                        metrics["genai_server_tbt"].record(
                            self._tbt, attributes
                        )
                        metrics["genai_server_ttft"].record(
                            self._ttft, attributes
                        )
                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_completion_tokens"].add(output_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                        metrics["genai_cost"].record(0, attributes)

                except Exception as e:
                    handle_exception(self._span, e)
                    logger.error("Error in trace creation: %s", e)
                finally:
                    self._span.end()
                raise

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'chat.completions' API call to add telemetry.

        This collects metrics such as execution time, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'chat.completions' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'chat.completions' method.
            kwargs: Keyword arguments for the 'chat.completions' method.

        Returns:
            The response from the original 'chat.completions' method.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("streaming", False)

        server_address, server_port = set_server_address_and_port(instance, "localhost", 80)
        request_model = str(instance.model.model_path).rsplit('/', maxsplit=1)[-1] or "orca-mini-3b-gguf2-q4_0.gguf"

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            awaited_wrapped = wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)

            return TracedSyncStream(awaited_wrapped, span, kwargs, server_address, server_port, request_model)

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
                start_time = time.time()
                response = wrapped(*args, **kwargs)
                end_time = time.time()

                try:
                    prompt = kwargs.get("prompt") or args[0] or ""

                    # Calculate tokens using input prompt and aggregated response
                    input_tokens = general_tokens(str(prompt))
                    output_tokens = general_tokens(str(response))

                    # Set Span attributes (OTel Semconv)
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT)
                    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_GPT4ALL)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.SERVER_PORT,
                                        server_port)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                        kwargs.get("repeat_penalty", 1.18))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_tokens", 200))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                        kwargs.get("presence_penalty", 0.0))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
                                        kwargs.get("temp", 0.7))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_P,
                                        kwargs.get("top_p", 0.4))
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_K,
                                        kwargs.get("top_k", 40))
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                        input_tokens)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                                        output_tokens)
                    span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        server_address)
                    if isinstance(response, str):
                        span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "text")
                    else:
                        span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "json")

                    # Set Span attributes (Extra)
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                        input_tokens + output_tokens)
                    span.set_attribute(SemanticConvention.GEN_AI_SERVER_TTFT,
                                        end_time - start_time)
                    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)
                    span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                        0)
                    if capture_message_content:
                        span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION: response,
                            },
                        )

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = create_metrics_attributes(
                            service_name=application_name,
                            deployment_environment=environment,
                            operation=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                            system=SemanticConvention.GEN_AI_SYSTEM_GPT4ALL,
                            request_model=request_model,
                            server_address=server_address,
                            server_port=server_port,
                            response_model=request_model,
                        )

                        metrics["genai_client_usage_tokens"].record(
                            input_tokens + output_tokens, attributes
                        )
                        metrics["genai_client_operation_duration"].record(
                            end_time - start_time, attributes
                        )
                        metrics["genai_server_ttft"].record(
                            end_time - start_time, attributes
                        )
                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_completion_tokens"].add(output_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                        metrics["genai_cost"].record(0, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper

def embed(version, environment, application_name,
              tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for embeddings to collect metrics.
    
    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the GPT4All API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating GPT4All usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the embeddings method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'embeddings' API call to add telemetry.

        This collects metrics such as execution time, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'embeddings' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'embeddings' method.
            kwargs: Keyword arguments for the 'embeddings' method.

        Returns:
            The response from the original 'embeddings' method.
        """

        server_address, server_port = set_server_address_and_port(instance, "localhost", 80)

        # pylint: disable=line-too-long
        request_model = str(instance.gpt4all.model.model_path).rsplit('/', maxsplit=1)[-1] or "all-MiniLM-L6-v2.gguf2.f16.gguf"

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING} {request_model}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                prompt = kwargs.get("prompt") or args[0] or ""
                input_tokens = general_tokens(prompt)

                # Set Span attributes (OTel Semconv)
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                    SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING)
                span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                    SemanticConvention.GEN_AI_SYSTEM_GPT4ALL)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                    server_address)
                span.set_attribute(SemanticConvention.SERVER_PORT,
                                    server_port)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                                    input_tokens)

                # Set Span attributes (Extras)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                    version)
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    0)

                if capture_message_content:
                    span.add_event(
                        name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvention.GEN_AI_CONTENT_PROMPT: str(kwargs.get("input", "")),
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                        system=SemanticConvention.GEN_AI_SYSTEM_GPT4ALL,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=request_model,
                    )
                    metrics["genai_client_usage_tokens"].record(
                            input_tokens, attributes
                        )
                    metrics["genai_client_operation_duration"].record(
                        end_time - start_time, attributes
                    )
                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_prompt_tokens"].add(input_tokens, attributes)
                    metrics["genai_cost"].record(0, attributes)


                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
