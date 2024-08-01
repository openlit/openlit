# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment
"""
Module for monitoring Anthropic API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import get_chat_model_cost, handle_exception
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def messages(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'messages' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'messages' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'messages' method.
            kwargs: Keyword arguments for the 'messages' method.

        Returns:
            The response from the original 'messages' method.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    # Loop through streaming events capturing relevant details
                    for event in wrapped(*args, **kwargs):

                        # Collect message IDs and input token from events
                        if event.type == "message_start":
                            response_id = event.message.id
                            prompt_tokens = event.message.usage.input_tokens

                        # Aggregate response content
                        if event.type == "content_block_delta":
                            llmresponse += event.delta.text

                        # Collect output tokens and stop reason from events
                        if event.type == "message_delta":
                            completion_tokens = event.usage.output_tokens
                            finish_reason = event.delta.stop_reason
                        yield event

                    # Handling exception ensure observability without disrupting operation
                    try:
                        # Format 'messages' into a single string
                        message_prompt = kwargs.get("messages", "")
                        formatted_messages = []
                        for message in message_prompt:
                            role = message["role"]
                            content = message["content"]

                            if isinstance(content, list):
                                content_str = ", ".join(
                                    # pylint: disable=line-too-long
                                    f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                                    if "type" in item else f'text: {item["text"]}'
                                    for item in content
                                )
                                formatted_messages.append(f"{role}: {content_str}")
                            else:
                                formatted_messages.append(f"{role}: {content}")
                        prompt = "\n".join(formatted_messages)

                        # Calculate cost of the operation
                        cost = get_chat_model_cost(
                            kwargs.get("model", "claude-3-sonnet-20240229"),
                            pricing_info, prompt_tokens, completion_tokens
                        )

                        # Set Span attributes
                        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                            SemanticConvetion.GEN_AI_SYSTEM_ANTHROPIC)
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                            SemanticConvetion.GEN_AI_TYPE_CHAT)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                            gen_ai_endpoint)
                        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                            response_id)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                            environment)
                        span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                            application_name)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                            kwargs.get("model", "claude-3-sonnet-20240229"))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                            kwargs.get("max_tokens", -1))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                            True)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                            kwargs.get("temperature", 1.0))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                            kwargs.get("top_p", ""))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_K,
                                            kwargs.get("top_k", ""))
                        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                            [finish_reason])
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            prompt_tokens + completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                            cost)
                        if trace_content:
                            span.add_event(
                                name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                                attributes={
                                    SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                                },
                            )
                            span.add_event(
                                name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                                attributes={
                                    SemanticConvetion.GEN_AI_CONTENT_COMPLETION: llmresponse,
                                },
                            )

                        span.set_status(Status(StatusCode.OK))

                        if disable_metrics is False:
                            attributes = {
                                TELEMETRY_SDK_NAME:
                                    "openlit",
                                SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                    application_name,
                                SemanticConvetion.GEN_AI_SYSTEM:
                                    SemanticConvetion.GEN_AI_SYSTEM_ANTHROPIC,
                                SemanticConvetion.GEN_AI_ENVIRONMENT:
                                    environment,
                                SemanticConvetion.GEN_AI_TYPE:
                                    SemanticConvetion.GEN_AI_TYPE_CHAT,
                                SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                    kwargs.get("model", "claude-3-sonnet-20240229")
                            }

                            metrics["genai_requests"].add(1, attributes)
                            metrics["genai_total_tokens"].add(
                                prompt_tokens + completion_tokens, attributes
                            )
                            metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                            metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                            metrics["genai_cost"].record(cost, attributes)

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in trace creation: %s", e)

            return stream_generator()

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
                response = wrapped(*args, **kwargs)

                try:
                    # Format 'messages' into a single string
                    message_prompt = kwargs.get("messages", "")
                    formatted_messages = []
                    for message in message_prompt:
                        role = message["role"]
                        content = message["content"]

                        if isinstance(content, list):
                            content_str = ", ".join(
                                # pylint: disable=line-too-long
                                f'{item["type"]}: {item["text"] if "text" in item else item["image_url"]}'
                                if "type" in item else f'text: {item["text"]}'
                                for item in content
                            )
                            formatted_messages.append(f"{role}: {content_str}")
                        else:
                            formatted_messages.append(f"{role}: {content}")
                    prompt = "\n".join(formatted_messages)

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "claude-3-sonnet-20240229"),
                                                pricing_info, response.usage.input_tokens,
                                                response.usage.output_tokens)

                    # Set Span attribues
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_ANTHROPIC)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                        response.id)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "claude-3-sonnet-20240229"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_tokens", -1))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                        kwargs.get("temperature", 1.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                        kwargs.get("top_p", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_K,
                                        kwargs.get("top_k", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                        [response.stop_reason])
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        response.usage.input_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        response.usage.output_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        response.usage.input_tokens +
                                        response.usage.output_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)

                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                # pylint: disable=line-too-long
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.content[0].text if response.content else "",
                            },
                        )

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_ANTHROPIC,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                kwargs.get("model", "claude-3-sonnet-20240229")
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            response.usage.input_tokens +
                            response.usage.output_tokens, attributes)
                        metrics["genai_completion_tokens"].add(
                            response.usage.output_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(
                            response.usage.input_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper
