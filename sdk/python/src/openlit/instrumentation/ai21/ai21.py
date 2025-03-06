"""
Module for monitoring AI21 calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import (
    get_chat_model_cost,
    handle_exception,
    response_as_dict,
    calculate_ttft,
    calculate_tbt,
    create_metrics_attributes,
    set_server_address_and_port,
    general_tokens
)
from openlit.instrumentation.ai21.utils import (
    process_chunk,
    process_chat_response,
    process_streaming_chat_response
)

from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
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
                kwargs,
                server_address,
                server_port,
                **args,
            ):
            self.__wrapped__ = wrapped
            self._span = span
            # Placeholder for aggregating streaming response
            self._llmresponse = ""
            self._response_id = ""
            self._finish_reason = ""
            self._input_tokens = 0
            self._output_tokens = 0
            self._choices = []

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
                # Handling exception ensure observability without disrupting operation
                try:
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
                finally:
                    self._span.end()
                raise

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)
        server_address, server_port = set_server_address_and_port(instance, "api.ai21.com", 443)
        request_model = kwargs.get("model", "jamba-1.5-mini")

        span_name = f"{SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            awaited_wrapped = wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            return TracedSyncStream(awaited_wrapped, span, kwargs, server_address, server_port)

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
                start_time = time.time()
                response = wrapped(*args, **kwargs)
                response_dict =response_as_dict(response)

                response = process_chat_response(
                    response=response_dict,
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

def chat_rag(version, environment, application_name,
                     tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the AI21 SDK.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of AI21 usage.
        capture_message_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat completions method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'chat.completions' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'chat.completions' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'chat.completions' method.
            kwargs: Keyword arguments for the 'chat.completions' method.

        Returns:
            The response from the original 'chat.completions' method.
        """

        server_address, server_port = set_server_address_and_port(instance, "api.ai21.com", 443)
        request_model = kwargs.get("model", "jamba-1.5-mini")

        span_name = f"{SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            response_dict = response_as_dict(response)

            try:
                # Format 'messages' into a single string
                message_prompt = kwargs.get("messages", "")
                formatted_messages = []
                for message in message_prompt:
                    role = message.role
                    content = message.content

                    if isinstance(content, list):
                        content_str = ", ".join(
                            f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                            if "type" in item else f'text: {item["text"]}'
                            for item in content
                        )
                        formatted_messages.append(f"{role}: {content_str}")
                    else:
                        formatted_messages.append(f"{role}: {content}")
                prompt = "\n".join(formatted_messages)

                input_tokens = general_tokens(prompt)

                # Set base span attribues (OTel Semconv)
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_OPERATION,
                                    SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_AI21)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                    kwargs.get("seed", ""))
                span.set_attribute(SemanticConvetion.SERVER_PORT,
                                    server_port)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                    kwargs.get("frequency_penalty", 0.0))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                    kwargs.get("max_tokens", -1))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                    kwargs.get("presence_penalty", 0.0))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_STOP_SEQUENCES,
                                    kwargs.get("stop", []))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                    kwargs.get("temperature", 0.4))
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                    kwargs.get("top_p", 1.0))
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                    response_dict.get("id"))
                span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_MODEL,
                                    request_model)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_INPUT_TOKENS,
                                    input_tokens)
                span.set_attribute(SemanticConvetion.SERVER_ADDRESS,
                                    server_address)

                # Set base span attribues (Extras)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                    environment)
                span.set_attribute(SERVICE_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_SERVER_TTFT,
                                    end_time - start_time)
                span.set_attribute(SemanticConvetion.GEN_AI_SDK_VERSION,
                                    version)
                span.set_attribute(SemanticConvetion.GEN_AI_RAG_MAX_SEGMENTS,
                                    kwargs.get("max_segments", -1))
                span.set_attribute(SemanticConvetion.GEN_AI_RAG_STRATEGY,
                                    kwargs.get("retrieval_strategy", "segments"))
                span.set_attribute(SemanticConvetion.GEN_AI_RAG_SIMILARITY_THRESHOLD,
                                    kwargs.get("retrieval_similarity_threshold", -1))
                span.set_attribute(SemanticConvetion.GEN_AI_RAG_MAX_NEIGHBORS,
                                    kwargs.get("max_neighbors", -1))
                span.set_attribute(SemanticConvetion.GEN_AI_RAG_FILE_IDS,
                                    str(kwargs.get("file_ids", "")))
                span.set_attribute(SemanticConvetion.GEN_AI_RAG_DOCUMENTS_PATH,
                                    kwargs.get("path", ""))
                if capture_message_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )

                output_tokens = 0
                for i in range(kwargs.get('n',1)):
                    output_tokens += general_tokens(response_dict.get('choices')[i].get('content'))

                    if capture_message_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                # pylint: disable=line-too-long
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: str(response_dict.get('choices')[i].get('content')),
                            },
                        )
                    if kwargs.get('tools'):
                        span.set_attribute(SemanticConvetion.GEN_AI_TOOL_CALLS,
                                        str(response_dict.get('choices')[i].get('message').get('tool_calls')))

                    if isinstance(response_dict.get('choices')[i].get('content'), str):
                        span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                                        "text")
                    elif response_dict.get('choices')[i].get('content') is not None:
                        span.set_attribute(SemanticConvetion.GEN_AI_OUTPUT_TYPE,
                                        "json")

                # Calculate cost of the operation
                cost = get_chat_model_cost(request_model,
                                            pricing_info, input_tokens,
                                            output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_OUTPUT_TOKENS,
                                    output_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    input_tokens + output_tokens)

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvetion.GEN_AI_OPERATION_TYPE_CHAT,
                        system=SemanticConvetion.GEN_AI_SYSTEM_AI21,
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
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
