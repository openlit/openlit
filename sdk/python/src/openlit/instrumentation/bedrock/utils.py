"""
AWS Bedrock OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    get_chat_model_cost,
    record_completion_metrics,
    common_span_attributes,
    handle_exception,
    general_tokens,
    otel_event,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(messages):
    """
    Format the messages into a string for span events.
    """

    if not messages:
        return ""

    formatted_messages = []
    for message in messages:
        if isinstance(message, dict):
            role = message.get("role", "user")
            content = message.get("content", "")
        else:
            # Handle Bedrock object format
            role = getattr(message, "role", "user")
            content = getattr(message, "content", "")

        if isinstance(content, list):
            # Handle structured content (e.g., text + images)
            text_parts = []
            for part in content:
                if isinstance(part, dict):
                    # Bedrock format: {"text": "content"} or generic format: {"type": "text", "text": "content"}
                    if "text" in part:
                        text_parts.append(part.get("text", ""))
                    elif part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
            content = " ".join(text_parts)
        elif not isinstance(content, str):
            content = str(content)

        formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)


def build_input_messages(messages):
    """
    Convert Bedrock messages to OTel input message structure.
    Follows gen-ai-input-messages schema.

    Args:
        messages: List of Bedrock message objects or dicts

    Returns:
        List of ChatMessage objects following OTel schema
    """
    structured_messages = []

    for message in messages:
        # Extract role and content
        if isinstance(message, dict):
            role = message.get("role", "user")
            content = message.get("content", [])
        else:
            # Handle Bedrock object format
            role = getattr(message, "role", "user")
            content = getattr(message, "content", [])

        # Ensure content is a list
        if isinstance(content, str):
            content = [{"text": content}]
        elif not isinstance(content, list):
            content = [{"text": str(content)}]

        # Build parts array
        parts = []
        for part in content:
            if isinstance(part, dict):
                # Handle text blocks
                if "text" in part:
                    parts.append({"type": "text", "content": part.get("text", "")})
                elif part.get("type") == "text":
                    parts.append({"type": "text", "content": part.get("text", "")})

                # Handle image blocks - only include if has URL (skip embedded bytes)
                elif "image" in part:
                    image_data = part.get("image", {})
                    source = image_data.get("source", {})
                    # Only include if URL-based, skip bytes
                    if "url" in source:
                        parts.append(
                            {
                                "type": "uri",
                                "modality": "image",
                                "uri": source.get("url"),
                            }
                        )

                # Handle document blocks - skip if has embedded bytes
                elif "document" in part:
                    document_data = part.get("document", {})
                    source = document_data.get("source", {})
                    # Only include if URL-based
                    if "url" in source:
                        parts.append(
                            {
                                "type": "uri",
                                "modality": "document",
                                "uri": source.get("url"),
                                "name": document_data.get("name", ""),
                            }
                        )

        if parts:
            structured_messages.append({"role": role, "parts": parts})

    return structured_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Bedrock response to OTel output message structure.
    Follows gen-ai-output-messages schema.

    Args:
        response_text: The text response from Bedrock
        finish_reason: Bedrock stopReason value
        tool_calls: Tool calls (reserved for future, currently None)

    Returns:
        List with single OutputMessage following OTel schema
    """
    parts = []

    # Add text content if present
    if response_text:
        parts.append({"type": "text", "content": response_text})

    # Add tool calls if present (future support)
    if tool_calls:
        for tool_call in tool_calls:
            parts.append(
                {
                    "type": "tool_call",
                    "id": tool_call.get("id", ""),
                    "name": tool_call.get("name", ""),
                    "arguments": tool_call.get("arguments", {}),
                }
            )

    # Map Bedrock finish reasons to OTel standard
    finish_reason_map = {
        "end_turn": "stop",
        "max_tokens": "max_tokens",
        "stop_sequence": "stop",
        "tool_use": "tool_calls",
        "content_filtered": "content_filter",
        "guardrail_intervention": "content_filter",
    }

    otel_finish_reason = finish_reason_map.get(finish_reason, finish_reason)

    return [{"role": "assistant", "parts": parts, "finish_reason": otel_finish_reason}]


def build_tool_definitions(tools):
    """
    Extract tool definitions from Bedrock toolConfig.

    Args:
        tools: Bedrock tools array from toolConfig

    Returns:
        List of tool definition objects or None

    Note: Currently returns None as Bedrock tool instrumentation is not yet implemented.
          Reserved for future when tool support is added.
    """
    # Bedrock tool support not yet instrumented
    # Will be implemented when tool calls are added to instrumentation
    return None


def _set_span_messages_as_array(span, input_messages, output_messages):
    """Set gen_ai.input.messages and gen_ai.output.messages on span as JSON array strings (OTel)."""
    try:
        if input_messages is not None:
            span.set_attribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                json.dumps(input_messages)
                if isinstance(input_messages, list)
                else input_messages,
            )
        if output_messages is not None:
            span.set_attribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                json.dumps(output_messages)
                if isinstance(output_messages, list)
                else output_messages,
            )
    except Exception as e:
        logger.warning("Failed to set span message attributes: %s", e, exc_info=True)


def emit_inference_event(
    event_provider,
    operation_name,
    request_model,
    response_model,
    input_messages=None,
    output_messages=None,
    tool_definitions=None,
    server_address=None,
    server_port=None,
    **extra_attrs,
):
    """
    Centralized function to emit gen_ai.client.inference.operation.details event.

    Args:
        event_provider: The OTel event provider
        operation_name: Operation type (chat, completion, embedding, etc.)
        request_model: Model specified in request
        response_model: Model returned in response
        input_messages: Structured input messages
        output_messages: Structured output messages
        tool_definitions: Tool/function definitions
        server_address: API server address
        server_port: API server port
        **extra_attrs: Additional attributes (temperature, max_tokens, etc.)
    """
    try:
        if not event_provider:
            return

        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_name,
        }
        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if response_model:
            attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = response_model
        if server_address:
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port:
            attributes[SemanticConvention.SERVER_PORT] = server_port
        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages
        if tool_definitions is not None:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions

        for key, value in extra_attrs.items():
            if value is not None:
                if key == "response_id":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
                elif key == "finish_reasons":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
                elif key == "output_type":
                    attributes[SemanticConvention.GEN_AI_OUTPUT_TYPE] = value
                elif key == "temperature":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] = value
                elif key == "max_tokens":
                    attributes[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] = value
                elif key == "top_p":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TOP_P] = value
                elif key == "top_k":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TOP_K] = value
                elif key == "frequency_penalty":
                    attributes[SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY] = (
                        value
                    )
                elif key == "presence_penalty":
                    attributes[SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY] = (
                        value
                    )
                elif key == "stop_sequences":
                    attributes[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES] = value
                elif key == "seed":
                    attributes[SemanticConvention.GEN_AI_REQUEST_SEED] = value
                elif key in ("choice_count", "n"):
                    if value != 1:
                        attributes[SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT] = (
                            value
                        )
                elif key == "input_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
                elif key == "output_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
                elif key == "cache_read_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS
                    ] = value
                elif key == "cache_creation_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                    ] = value
                elif key == "system_instructions":
                    attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
                elif key == "error_type":
                    attributes[SemanticConvention.ERROR_TYPE] = value
                elif key == "conversation_id":
                    attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = value
                else:
                    attributes[key] = value

        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )
        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def process_chunk(scope, chunk):
    """
    Process a chunk of response data and update state.
    """

    end_time = time.time()
    scope._timestamps.append(end_time)

    if len(scope._timestamps) == 1:
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    chunked = response_as_dict(chunk)

    if "messageStart" in chunked:
        message_start = chunked.get("messageStart", {})
        scope._response_role = message_start.get("role", "assistant")

    if "contentBlockDelta" in chunked:
        content_delta = chunked.get("contentBlockDelta", {})
        delta = content_delta.get("delta", {})
        if "text" in delta:
            scope._llmresponse += delta.get("text", "")

    if "messageStop" in chunked:
        message_stop = chunked.get("messageStop", {})
        scope._finish_reason = message_stop.get("stopReason", "")

    # Handle token usage including reasoning tokens and cached tokens
    if "metadata" in chunked:
        metadata = chunked.get("metadata") or {}
        usage = metadata.get("usage") or {}
        scope._input_tokens = usage.get("inputTokens", 0) or 0
        scope._output_tokens = usage.get("outputTokens", 0) or 0
        scope._cache_read_input_tokens = usage.get("cacheReadInputTokens", 0) or 0
        scope._cache_creation_input_tokens = usage.get("cacheWriteInputTokens", 0) or 0
        scope._end_time = end_time


def common_chat_logic(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    is_stream,
    event_provider=None,
):
    """
    Process chat request and generate Telemetry
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    llm_config = getattr(scope, "_llm_config", None) or {}
    prompt = format_content(scope._kwargs.get("messages", []))
    request_model = scope._kwargs.get("modelId", "amazon.titan-text-express-v1")

    # Calculate tokens and cost
    if hasattr(scope, "_input_tokens") and scope._input_tokens is not None:
        input_tokens = scope._input_tokens
        output_tokens = scope._output_tokens
    else:
        input_tokens = general_tokens(prompt)
        output_tokens = general_tokens(scope._llmresponse)

    cost = get_chat_model_cost(request_model, pricing_info, input_tokens, output_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK,
        scope._server_address,
        scope._server_port,
        request_model,
        scope._response_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters (Bedrock inferenceConfig)
    bedrock_attributes = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "frequencyPenalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "maxTokens"),
        (SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY, "presencePenalty"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stopSequences"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "topP"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "topK"),
    ]
    for attribute, key in bedrock_attributes:
        value = (
            llm_config.get(key)
            if isinstance(llm_config, dict)
            else getattr(llm_config, key, None)
        )
        if value is not None:
            scope._span.set_attribute(attribute, value)

    # Span Attributes for Response parameters
    if getattr(scope, "_response_id", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Tools
    if hasattr(scope, "_tools") and scope._tools:
        tools = scope._tools if isinstance(scope._tools, dict) else {}
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME, tools.get("name", "")
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, str(tools.get("id", ""))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS, str(tools.get("args", ""))
        )

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens + output_tokens
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # OTel cached token attributes (set even when 0)
    if hasattr(scope, "_cache_read_input_tokens"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
            scope._cache_read_input_tokens,
        )
    if hasattr(scope, "_cache_creation_input_tokens"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
            scope._cache_creation_input_tokens,
        )

    # Span Attributes for Content (OTel: array structure for gen_ai.input.messages / gen_ai.output.messages)
    if capture_message_content:
        input_msgs = build_input_messages(scope._kwargs.get("messages", []))
        output_msgs = build_output_messages(
            scope._llmresponse,
            scope._finish_reason,
            tool_calls=None,
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)
        # gen_ai.system_instructions (Bedrock: from system block in request when present)
        system_parts = []
        system_block = scope._kwargs.get("system") or []
        if system_block and isinstance(system_block, list):
            for item in system_block:
                if isinstance(item, dict) and item.get("text"):
                    system_parts.append({"type": "text", "content": item["text"]})
            if system_parts:
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                    json.dumps(system_parts),
                )

        if event_provider:
            try:
                tool_defs = (
                    build_tool_definitions(
                        (scope._kwargs.get("toolConfig") or {}).get("tools")
                    )
                    or []
                )
                output_type = "text" if isinstance(scope._llmresponse, str) else "json"
                extra = {
                    "response_id": getattr(scope, "_response_id", None),
                    "finish_reasons": [scope._finish_reason],
                    "output_type": output_type,
                    "temperature": llm_config.get("temperature")
                    if isinstance(llm_config, dict)
                    else getattr(llm_config, "temperature", None),
                    "max_tokens": llm_config.get("maxTokens")
                    if isinstance(llm_config, dict)
                    else getattr(llm_config, "maxTokens", None),
                    "top_p": llm_config.get("topP")
                    if isinstance(llm_config, dict)
                    else getattr(llm_config, "topP", None),
                    "top_k": llm_config.get("topK")
                    if isinstance(llm_config, dict)
                    else getattr(llm_config, "topK", None),
                    "stop_sequences": llm_config.get("stopSequences")
                    if isinstance(llm_config, dict)
                    else getattr(llm_config, "stopSequences", None),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                }
                if system_parts:
                    extra["system_instructions"] = system_parts
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                    request_model=request_model,
                    response_model=scope._response_model,
                    input_messages=input_msgs,
                    output_messages=output_msgs,
                    tool_definitions=tool_defs,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    **extra,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_AWS_BEDROCK,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            input_tokens,
            output_tokens,
            cost,
            scope._tbt,
            scope._ttft,
        )


def process_streaming_chat_response(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content=False,
    disable_metrics=False,
    version="",
    event_provider=None,
):
    """
    Process streaming chat response and generate telemetry.
    """

    try:
        common_chat_logic(
            scope,
            pricing_info,
            environment,
            application_name,
            metrics,
            capture_message_content,
            disable_metrics,
            version,
            is_stream=True,
            event_provider=event_provider,
        )
    except Exception as e:
        handle_exception(scope._span, e)
        raise


def process_chat_response(
    response,
    request_model,
    pricing_info,
    server_port,
    server_address,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content=False,
    disable_metrics=False,
    version="1.0.0",
    llm_config=None,
    event_provider=None,
    **kwargs,
):
    """
    Process non-streaming chat response and generate telemetry.
    """

    try:
        if llm_config is None:
            llm_config = {}

        scope = type("GenericScope", (), {})()
        response_dict = response_as_dict(response)

        scope._start_time = start_time
        scope._end_time = time.time()
        scope._span = span
        scope._llmresponse = (
            response_dict.get("output", {})
            .get("message", {})
            .get("content", [{}])[0]
            .get("text", "")
        )
        scope._response_role = (
            response_dict.get("output", {}).get("message", {}).get("role", "assistant")
        )
        # Handle token usage including reasoning tokens and cached tokens
        usage = response_dict.get("usage") or {}
        scope._input_tokens = usage.get("inputTokens", 0) or 0
        scope._output_tokens = usage.get("outputTokens", 0) or 0
        scope._cache_read_input_tokens = usage.get("cacheReadInputTokens", 0) or 0
        scope._cache_creation_input_tokens = usage.get("cacheWriteInputTokens", 0) or 0
        scope._response_model = request_model
        scope._finish_reason = response_dict.get("stopReason", "")
        scope._response_id = response_dict.get("RequestId", "")
        scope._timestamps = []
        scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
        scope._server_address, scope._server_port = server_address, server_port
        scope._kwargs = kwargs
        scope._llm_config = llm_config or {}

        common_chat_logic(
            scope,
            pricing_info,
            environment,
            application_name,
            metrics,
            capture_message_content,
            disable_metrics,
            version,
            is_stream=False,
            event_provider=event_provider,
        )

        return response
    except Exception as e:
        handle_exception(span, e)
        raise
