"""
Anthropic OpenTelemetry instrumentation utility functions
"""

import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    get_chat_model_cost,
    record_completion_metrics,
    common_span_attributes,
)
from openlit.semcov import SemanticConvention


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
            # Handle Anthropic object format
            role = getattr(message, "role", "user")
            content = getattr(message, "content", "")

        if isinstance(content, list):
            # Handle structured content (e.g., text + images)
            text_parts = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    text_parts.append(part.get("text", ""))
            content = " ".join(text_parts)
        elif not isinstance(content, str):
            content = str(content)

        formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)


def build_input_messages(messages, system=None):
    """
    Convert Anthropic request messages to OTel input message structure.

    Args:
        messages: Anthropic messages array from request
        system: Optional system instruction string

    Returns:
        List of ChatMessage objects with role and parts
    """
    import logging

    logger = logging.getLogger(__name__)

    if not messages:
        return []

    otel_messages = []

    # Add system message first if present
    if system:
        otel_messages.append(
            {"role": "system", "parts": [{"type": "text", "content": system}]}
        )

    for message in messages:
        try:
            # Extract role
            role = (
                message.get("role", "user")
                if isinstance(message, dict)
                else getattr(message, "role", "user")
            )

            # Extract content
            content = (
                message.get("content", "")
                if isinstance(message, dict)
                else getattr(message, "content", "")
            )

            parts = []

            if isinstance(content, list):
                # Multi-part content (text, images, tool results)
                for item in content:
                    item_type = (
                        item.get("type")
                        if isinstance(item, dict)
                        else getattr(item, "type", None)
                    )

                    if item_type == "text":
                        text_content = (
                            item.get("text", "")
                            if isinstance(item, dict)
                            else getattr(item, "text", "")
                        )
                        if text_content:
                            parts.append({"type": "text", "content": text_content})

                    elif item_type == "image":
                        # Anthropic image format: {"type": "image", "source": {"type": "url", "url": "..."}}
                        source = (
                            item.get("source", {})
                            if isinstance(item, dict)
                            else getattr(item, "source", {})
                        )
                        if isinstance(source, dict) and source.get("type") == "url":
                            url = source.get("url", "")
                            if url and not url.startswith("data:"):
                                parts.append(
                                    {"type": "uri", "modality": "image", "uri": url}
                                )

                    elif item_type == "tool_use":
                        # Anthropic tool use in request (assistant message)
                        tool_id = (
                            item.get("id", "")
                            if isinstance(item, dict)
                            else getattr(item, "id", "")
                        )
                        tool_name = (
                            item.get("name", "")
                            if isinstance(item, dict)
                            else getattr(item, "name", "")
                        )
                        tool_input = (
                            item.get("input", {})
                            if isinstance(item, dict)
                            else getattr(item, "input", {})
                        )
                        parts.append(
                            {
                                "type": "tool_call",
                                "id": tool_id,
                                "name": tool_name,
                                "arguments": tool_input,
                            }
                        )

                    elif item_type == "tool_result":
                        # Anthropic tool result (user providing tool response)
                        tool_id = (
                            item.get("tool_use_id", "")
                            if isinstance(item, dict)
                            else getattr(item, "tool_use_id", "")
                        )
                        tool_content = (
                            item.get("content", "")
                            if isinstance(item, dict)
                            else getattr(item, "content", "")
                        )
                        parts.append(
                            {
                                "type": "tool_call_response",
                                "id": tool_id,
                                "response": str(tool_content),
                            }
                        )

            elif isinstance(content, str) and content:
                # Simple string content
                parts.append({"type": "text", "content": content})

            if parts:
                otel_messages.append({"role": role, "parts": parts})

        except Exception as e:
            logger.warning("Failed to process input message: %s", e, exc_info=True)
            continue

    return otel_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Anthropic response to OTel output message structure.

    Args:
        response_text: Response text from model
        finish_reason: Finish reason from Anthropic (end_turn, max_tokens, stop_sequence, tool_use)
        tool_calls: Optional tool calls dict from response

    Returns:
        List with single OutputMessage
    """
    import logging

    logger = logging.getLogger(__name__)

    parts = []

    try:
        # Add text content if present
        if response_text:
            parts.append({"type": "text", "content": response_text})

        # Add tool call if present
        if tool_calls:
            parts.append(
                {
                    "type": "tool_call",
                    "id": tool_calls.get("id", ""),
                    "name": tool_calls.get("name", ""),
                    "arguments": tool_calls.get("input", {}),
                }
            )

        # Map Anthropic finish reasons to OTel standard
        finish_reason_map = {
            "end_turn": "stop",
            "max_tokens": "max_tokens",
            "stop_sequence": "stop",
            "tool_use": "tool_calls",
        }

        otel_finish_reason = finish_reason_map.get(
            finish_reason, finish_reason or "stop"
        )

        return [
            {"role": "assistant", "parts": parts, "finish_reason": otel_finish_reason}
        ]

    except Exception as e:
        logger.warning("Failed to build output messages: %s", e, exc_info=True)
        return [{"role": "assistant", "parts": [], "finish_reason": "stop"}]


def build_tool_definitions(tools):
    """
    Extract tool/function definitions from Anthropic request.

    Args:
        tools: Tools array from Anthropic request

    Returns:
        List of tool definition objects or None
    """
    import logging

    logger = logging.getLogger(__name__)

    if not tools:
        return None

    try:
        tool_definitions = []

        for tool in tools:
            try:
                if isinstance(tool, dict):
                    # Anthropic format already compatible with OTel
                    tool_definitions.append(
                        {
                            "type": "function",
                            "name": tool.get("name", ""),
                            "description": tool.get("description", ""),
                            "parameters": tool.get("input_schema", {}),
                        }
                    )
                else:
                    # Handle object format
                    tool_definitions.append(
                        {
                            "type": "function",
                            "name": getattr(tool, "name", ""),
                            "description": getattr(tool, "description", ""),
                            "parameters": getattr(tool, "input_schema", {}),
                        }
                    )
            except Exception as e:
                logger.warning(
                    "Failed to process tool definition: %s", e, exc_info=True
                )
                continue

        return tool_definitions if tool_definitions else None

    except Exception as e:
        logger.warning("Failed to build tool definitions: %s", e, exc_info=True)
        return None


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
    Emit gen_ai.client.inference.operation.details event.

    Args:
        event_provider: The OTel event provider
        operation_name: Operation type (chat)
        request_model: Model from request
        response_model: Model from response
        input_messages: Structured input messages
        output_messages: Structured output messages
        tool_definitions: Tool definitions
        server_address: Server address
        server_port: Server port
        **extra_attrs: Additional attributes (temperature, max_tokens, etc.)
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        if not event_provider:
            return

        from openlit.__helpers import otel_event

        # Build event attributes
        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_name,
        }

        # Add model attributes
        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if response_model:
            attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = response_model

        # Add server attributes
        if server_address:
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port:
            attributes[SemanticConvention.SERVER_PORT] = server_port

        # Add messages
        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages

        # Add tool definitions
        if tool_definitions is not None:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions

        # Map extra attributes
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
                elif key == "stop_sequences":
                    attributes[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES] = value
                elif key == "input_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
                elif key == "output_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
                elif key == "cache_creation_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                    ] = value
                elif key == "cache_read_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS
                    ] = value

        # Create and emit event
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
    # Record the timestamp for the current chunk
    scope._timestamps.append(end_time)

    if len(scope._timestamps) == 1:
        # Calculate time to first chunk
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    chunked = response_as_dict(chunk)

    # Collect message IDs and input token from events
    if chunked.get("type") == "message_start":
        scope._response_id = chunked.get("message").get("id")
        message_usage = chunked.get("message").get("usage", {})
        scope._input_tokens = message_usage.get("input_tokens", 0)
        # Extract cache tokens from message_start event
        scope._cache_creation_input_tokens = message_usage.get(
            "cache_creation_input_tokens", 0
        )
        scope._cache_read_input_tokens = message_usage.get("cache_read_input_tokens", 0)
        scope._response_model = chunked.get("message").get("model")
        scope._response_role = chunked.get("message").get("role")

    # Collect message IDs and aggregated response from events
    if chunked.get("type") == "content_block_delta":
        if chunked.get("delta").get("text"):
            scope._llmresponse += chunked.get("delta").get("text")
        elif chunked.get("delta").get("partial_json"):
            scope._tool_arguments += chunked.get("delta").get("partial_json")

    if chunked.get("type") == "content_block_start":
        if chunked.get("content_block").get("id"):
            scope._tool_id = chunked.get("content_block").get("id")
        if chunked.get("content_block").get("name"):
            scope._tool_name = chunked.get("content_block").get("name")

    # Collect output tokens and stop reason from events
    if chunked.get("type") == "message_delta":
        scope._output_tokens = chunked.get("usage").get("output_tokens")
        scope._finish_reason = chunked.get("delta").get("stop_reason")


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

    formatted_messages = format_content(scope._kwargs.get("messages", []))
    request_model = scope._kwargs.get("model", "claude-3-5-sonnet-latest")

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC,
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

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        scope._kwargs.get("max_tokens", -1),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        scope._kwargs.get("stop_sequences", []),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        scope._kwargs.get("temperature", 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_K, scope._kwargs.get("top_k", 1.0)
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P, scope._kwargs.get("top_p", 1.0)
    )

    # Span Attributes for Response parameters
    scope._span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, scope._output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        scope._input_tokens + scope._output_tokens,
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Handle tool calls if present
    if scope._tool_calls:
        # Optimized tool handling - extract name, id, and arguments
        tool_name = scope._tool_calls.get("name", "")
        tool_id = scope._tool_calls.get("id", "")
        tool_args = scope._tool_calls.get("input", "")

        scope._span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, tool_name)
        scope._span.set_attribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, tool_id)
        scope._span.set_attribute(SemanticConvention.GEN_AI_TOOL_ARGS, str(tool_args))

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_CONTENT_PROMPT, formatted_messages
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_CONTENT_COMPLETION, scope._llmresponse
        )

        # Emit inference event
        if event_provider:
            import logging

            logger = logging.getLogger(__name__)
            try:
                input_msgs = build_input_messages(
                    scope._kwargs.get("messages", []),
                    system=scope._kwargs.get("system"),
                )
                output_msgs = build_output_messages(
                    scope._llmresponse, scope._finish_reason, scope._tool_calls
                )
                tool_defs = build_tool_definitions(scope._kwargs.get("tools"))

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
                    response_id=scope._response_id,
                    finish_reasons=[scope._finish_reason],
                    temperature=scope._kwargs.get("temperature"),
                    max_tokens=scope._kwargs.get("max_tokens"),
                    top_p=scope._kwargs.get("top_p"),
                    top_k=scope._kwargs.get("top_k"),
                    stop_sequences=scope._kwargs.get("stop_sequences"),
                    input_tokens=scope._input_tokens,
                    output_tokens=scope._output_tokens,
                    cache_creation_input_tokens=scope._cache_creation_input_tokens
                    if hasattr(scope, "_cache_creation_input_tokens")
                    and scope._cache_creation_input_tokens > 0
                    else None,
                    cache_read_input_tokens=scope._cache_read_input_tokens
                    if hasattr(scope, "_cache_read_input_tokens")
                    and scope._cache_read_input_tokens > 0
                    else None,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            scope._input_tokens,
            scope._output_tokens,
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

    if scope._tool_id != "":
        scope._tool_calls = {
            "id": scope._tool_id,
            "name": scope._tool_name,
            "input": scope._tool_arguments,
        }

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
    event_provider=None,
    **kwargs,
):
    """
    Process non-streaming chat response and generate telemetry.
    """

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    # pylint: disable = no-member
    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._llmresponse = response_dict.get("content", [{}])[0].get("text", "")
    scope._response_role = response_dict.get("role", "assistant")

    # Extract usage including cache tokens (Anthropic prompt caching)
    usage = response_dict.get("usage", {})
    scope._input_tokens = usage.get("input_tokens", 0)
    scope._output_tokens = usage.get("output_tokens", 0)
    scope._cache_creation_input_tokens = usage.get("cache_creation_input_tokens", 0)
    scope._cache_read_input_tokens = usage.get("cache_read_input_tokens", 0)

    scope._response_model = response_dict.get("model", "")
    scope._finish_reason = response_dict.get("stop_reason", "")
    scope._response_id = response_dict.get("id", "")
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    # Handle tool calls if present
    content_blocks = response_dict.get("content", [])
    scope._tool_calls = None
    for block in content_blocks:
        if block.get("type") == "tool_use":
            scope._tool_calls = {
                "id": block.get("id", ""),
                "name": block.get("name", ""),
                "input": block.get("input", ""),
            }
            break

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
