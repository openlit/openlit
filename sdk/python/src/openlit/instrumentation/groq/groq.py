# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, used-before-assignment, too-many-branches
"""
Module for monitoring Groq API calls.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import get_chat_model_cost, handle_exception
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def chat(gen_ai_endpoint, version, environment, application_name,
                     tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for chat completions to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Groq API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Groq usage.
        trace_content: Flag indicating whether to trace the actual content.

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
                    for chunk in wrapped(*args, **kwargs):
                        # Collect message IDs and aggregated response from events
                        if len(chunk.choices) > 0:
                            # pylint: disable=line-too-long
                            if hasattr(chunk.choices[0], "delta") and hasattr(chunk.choices[0].delta, "content"):
                                content = chunk.choices[0].delta.content
                                if content:
                                    llmresponse += content
                            if chunk.x_groq is not None and chunk.x_groq.usage is not None:
                                prompt_tokens = chunk.x_groq.usage.prompt_tokens
                                completion_tokens = chunk.x_groq.usage.completion_tokens
                                total_tokens = chunk.x_groq.usage.total_tokens
                                response_id = chunk.x_groq.id
                        yield chunk

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
                        cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"),
                                                    pricing_info, prompt_tokens,
                                                    completion_tokens)

                        # Set Span attributes
                        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                            SemanticConvetion.GEN_AI_SYSTEM_GROQ)
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
                                            kwargs.get("model", "gpt-3.5-turbo"))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_USER,
                                            kwargs.get("user", ""))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                            kwargs.get("top_p", 1.0))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                            kwargs.get("max_tokens", -1))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                            kwargs.get("temperature", 1.0))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                            kwargs.get("presence_penalty", 0.0))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                            kwargs.get("frequency_penalty", 0.0))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                            kwargs.get("seed", ""))
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                            True)
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
                                    SemanticConvetion.GEN_AI_SYSTEM_GROQ,
                                SemanticConvetion.GEN_AI_ENVIRONMENT:
                                    environment,
                                SemanticConvetion.GEN_AI_TYPE:
                                    SemanticConvetion.GEN_AI_TYPE_CHAT,
                                SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                    kwargs.get("model", "gpt-3.5-turbo")
                            }

                            metrics["genai_requests"].add(1, attributes)
                            metrics["genai_total_tokens"].add(
                                total_tokens, attributes
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
            # pylint: disable=line-too-long
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
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

                    # Set base span attribues
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_GROQ)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_ID,
                                        response.x_groq["id"])
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        kwargs.get("model", "llama3-8b-8192"))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TOP_P,
                                        kwargs.get("top_p", 1.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MAX_TOKENS,
                                        kwargs.get("max_tokens", -1))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_USER,
                                        kwargs.get("name", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_TEMPERATURE,
                                        kwargs.get("temperature", 1.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_PRESENCE_PENALTY,
                                        kwargs.get("presence_penalty", 0.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_FREQUENCY_PENALTY,
                                        kwargs.get("frequency_penalty", 0.0))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_SEED,
                                        kwargs.get("seed", ""))
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )

                    # Set span attributes when tools is not passed to the function call
                    if "tools" not in kwargs:
                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "llama3-8b-8192"),
                                                    pricing_info, response.usage.prompt_tokens,
                                                    response.usage.completion_tokens)

                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            response.usage.prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            response.usage.completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            response.usage.total_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                            [response.choices[0].finish_reason])
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                            cost)

                        # Set span attributes for when n = 1 (default)
                        if "n" not in kwargs or kwargs["n"] == 1:
                            if trace_content:
                                span.add_event(
                                    name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                                    attributes={
                                        SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.choices[0].message.content,
                                    },
                                )

                        # Set span attributes for when n > 0
                        else:
                            i = 0
                            while i < kwargs["n"] and trace_content is True:
                                attribute_name = f"gen_ai.completion.{i}"
                                span.add_event(
                                    name=attribute_name,
                                    attributes={
                                        SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.choices[i].message.content,
                                    },
                                )
                                i += 1

                            # Return original response
                            return response

                    # Set span attributes when tools is passed to the function call
                    elif "tools" in kwargs:
                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "gpt-3.5-turbo"),
                                                    pricing_info, response.usage.prompt_tokens,
                                                    response.usage.completion_tokens)

                        span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_COMPLETION,
                                            "Function called with tools")
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            response.usage.prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            response.usage.completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            response.usage.total_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                            cost)

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_GROQ,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                kwargs.get("model", "gpt-3.5-turbo")
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(response.usage.total_tokens, attributes)
                        metrics["genai_completion_tokens"].add(response.usage.completion_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(response.usage.prompt_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper
