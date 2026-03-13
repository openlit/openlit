"""
Cohere OpenTelemetry instrumentation utility functions
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
    get_embed_model_cost,
    common_span_attributes,
    record_completion_metrics,
    record_embedding_metrics,
    otel_event,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(messages):
    """
    Process a list of messages to extract content.
    """

    formatted_messages = []
    for message in messages:
        # Handle both dictionary and object formats
        if isinstance(message, dict):
            role = message.get("role", "user")
            content = message.get("content", "")
        else:
            # Handle Cohere object format (e.g., cohere.UserChatMessageV2)
            role = getattr(message, "role", "user")
            content = getattr(message, "content", "")

        if isinstance(content, list):
            content_str = ", ".join(
                f"{item['type']}: {item['text'] if 'text' in item else item.get('image_url', '')}"
                if "type" in item
                else f"text: {item.get('text', '')}"
                for item in content
            )
            formatted_messages.append(f"{role}: {content_str}")
        else:
            formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)


def build_input_messages(messages):
    """
    Convert Cohere request messages to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    structured_messages = []
    for msg in messages or []:
        if isinstance(msg, dict):
            role = msg.get("role", "user")
            content = msg.get("content", "")
        else:
            role = getattr(msg, "role", "user")
            content = getattr(msg, "content", "")
        parts = []
        if isinstance(content, str):
            parts.append({"type": "text", "content": content})
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict):
                    if part.get("type") == "text":
                        parts.append({"type": "text", "content": part.get("text", "")})
                else:
                    parts.append({"type": "text", "content": str(content)})
        if parts:
            structured_messages.append({"role": role, "parts": parts})
    return structured_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Cohere response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    parts = []
    if response_text:
        parts.append({"type": "text", "content": response_text})
    if tool_calls:
        for tool_call in tool_calls:
            tc = tool_call if isinstance(tool_call, dict) else {}
            fn = tc.get("function", {}) or {}
            parts.append(
                {
                    "type": "tool_call",
                    "id": tc.get("id", ""),
                    "name": fn.get("name", ""),
                    "arguments": fn.get("arguments", ""),
                }
            )
    finish_reason_map = {
        "complete": "stop",
        "stop": "stop",
        "max_tokens": "max_tokens",
        "tool_use": "tool_calls",
    }
    otel_finish = finish_reason_map.get(finish_reason, finish_reason or "stop")
    return [{"role": "assistant", "parts": parts, "finish_reason": otel_finish}]


def build_tool_definitions(tools):
    """Extract tool definitions from Cohere request. Returns tools or None."""
    return tools if tools else None


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
    Emit gen_ai.client.inference.operation.details event.
    """
    try:
        if not event_provider:
            return
        attributes = {SemanticConvention.GEN_AI_OPERATION: operation_name}
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
            if key == "response_id" and value is not None:
                attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
            elif key == "finish_reasons" and value is not None:
                attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
            elif key == "output_type" and value is not None:
                attributes[SemanticConvention.GEN_AI_OUTPUT_TYPE] = value
            elif key == "temperature" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] = value
            elif key == "max_tokens" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] = value
            elif key == "top_p" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_TOP_P] = value
            elif key == "top_k" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_TOP_K] = value
            elif key == "frequency_penalty" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY] = value
            elif key == "presence_penalty" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY] = value
            elif key == "stop_sequences" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES] = value
            elif key == "seed" and value is not None:
                attributes[SemanticConvention.GEN_AI_REQUEST_SEED] = value
            elif key in ("choice_count", "n") and value is not None and value != 1:
                attributes[SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT] = value
            elif key == "input_tokens" and value is not None:
                attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
            elif key == "output_tokens" and value is not None:
                attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
            elif key == "cache_read_input_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = (
                    value if value is not None else 0
                )
            elif key == "cache_creation_input_tokens":
                attributes[
                    SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                ] = value if value is not None else 0
            elif key == "error_type" and value is not None:
                attributes[SemanticConvention.ERROR_TYPE] = value
            elif key == "system_instructions" and value is not None:
                attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
            elif key == "conversation_id" and value is not None:
                attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = value
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

    # Handle different chunk types for Cohere streaming
    if chunked.get("type") == "message-start":
        scope._response_id = chunked.get("id")

    if chunked.get("type") == "content-delta":
        content = (
            chunked.get("delta", {}).get("message", {}).get("content", {}).get("text")
        )
        if content:
            scope._llmresponse += content

    # Handle tool plan deltas
    if chunked.get("type") == "tool-plan-delta":
        tool_plan_text = (
            chunked.get("delta", {}).get("message", {}).get("tool_plan", "")
        )
        if tool_plan_text:
            if not hasattr(scope, "_tool_plan"):
                scope._tool_plan = ""
            scope._tool_plan += tool_plan_text

    # Handle tool call start
    if chunked.get("type") == "tool-call-start":
        if not hasattr(scope, "_tools") or scope._tools is None:
            scope._tools = []

        index = chunked.get("index", 0)
        tool_call = chunked.get("delta", {}).get("message", {}).get("tool_calls", {})

        # Extend list if needed
        scope._tools.extend([{}] * (index + 1 - len(scope._tools)))

        # Initialize tool call
        scope._tools[index] = {
            "id": tool_call.get("id", ""),
            "type": tool_call.get("type", "function"),
            "function": {
                "name": tool_call.get("function", {}).get("name", ""),
                "arguments": "",
            },
        }

    # Handle tool call deltas (arguments)
    if chunked.get("type") == "tool-call-delta":
        if hasattr(scope, "_tools") and scope._tools:
            index = chunked.get("index", 0)
            if index < len(scope._tools):
                arguments = (
                    chunked.get("delta", {})
                    .get("message", {})
                    .get("tool_calls", {})
                    .get("function", {})
                    .get("arguments", "")
                )
                if arguments:
                    scope._tools[index]["function"]["arguments"] += arguments

    if chunked.get("type") == "message-end":
        delta = chunked.get("delta", {})
        scope._finish_reason = delta.get("finish_reason", "")
        usage = delta.get("usage", {})
        billed = usage.get("billed_units", {})
        # Handle token usage including reasoning tokens and cached tokens
        scope._input_tokens = billed.get("input_tokens", 0)
        scope._output_tokens = billed.get("output_tokens", 0)
        scope._cache_read_input_tokens = getattr(scope, "_cache_read_input_tokens", 0)
        scope._cache_creation_input_tokens = getattr(
            scope, "_cache_creation_input_tokens", 0
        )
        scope._end_time = time.time()


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

    scope._end_time = getattr(scope, "_end_time", None) or time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    request_model = scope._kwargs.get("model", "command-r-plus-08-2024")

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_COHERE,
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
        SemanticConvention.GEN_AI_REQUEST_SEED, scope._kwargs.get("seed", "")
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        scope._kwargs.get("frequency_penalty", 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        scope._kwargs.get("max_tokens", -1),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        scope._kwargs.get("presence_penalty", 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        scope._kwargs.get("stop_sequences", []),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        scope._kwargs.get("temperature", 0.3),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_K, scope._kwargs.get("k", 1.0)
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P, scope._kwargs.get("p", 1.0)
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

    # Span Attributes for Tools
    if scope._tools:
        tools = scope._tools if isinstance(scope._tools, list) else [scope._tools]

        names, ids, args = (
            zip(
                *[
                    (
                        t.get("function", {}).get("name", ""),
                        str(t.get("id", "")),
                        str(t.get("function", {}).get("arguments", "")),
                    )
                    for t in tools
                    if isinstance(t, dict) and t
                ]
            )
            if tools
            else ([], [], [])
        )

        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_NAME, ", ".join(filter(None, names))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_CALL_ID, ", ".join(filter(None, ids))
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_ARGS, ", ".join(filter(None, args))
        )

    # Span Attributes for Tool Plan (Cohere specific)
    if hasattr(scope, "_tool_plan") and scope._tool_plan:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_CONTENT_REASONING, scope._tool_plan
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
            scope._llmresponse, scope._finish_reason, scope._tools
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        # Emit inference event
        if event_provider:
            try:
                tool_defs = build_tool_definitions(scope._kwargs.get("tools"))
                extra = {
                    "response_id": scope._response_id,
                    "finish_reasons": [scope._finish_reason],
                    "output_type": "text"
                    if isinstance(scope._llmresponse, str)
                    else "json",
                    "temperature": scope._kwargs.get("temperature"),
                    "max_tokens": scope._kwargs.get("max_tokens"),
                    "top_p": scope._kwargs.get("p"),
                    "top_k": scope._kwargs.get("k"),
                    "frequency_penalty": scope._kwargs.get("frequency_penalty"),
                    "presence_penalty": scope._kwargs.get("presence_penalty"),
                    "stop_sequences": scope._kwargs.get("stop_sequences"),
                    "seed": scope._kwargs.get("seed"),
                    "input_tokens": scope._input_tokens,
                    "output_tokens": scope._output_tokens,
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                }
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

    # Span status and metrics
    if not disable_metrics:
        inter_chunk_durations = None
        if getattr(scope, "_timestamps", None) and len(scope._timestamps) > 1:
            inter_chunk_durations = [
                scope._timestamps[i] - scope._timestamps[i - 1]
                for i in range(1, len(scope._timestamps))
            ]
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_COHERE,
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
            is_stream=is_stream,
            time_per_chunk_observations=inter_chunk_durations,
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
    Process streaming chat request and generate Telemetry
    """

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
    Process chat request and generate Telemetry
    """

    # Create scope object
    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    # Extract response content - handle both text and tool responses
    message = response_dict.get("message", {})
    content_list = message.get("content", [])
    if content_list and isinstance(content_list, list) and len(content_list) > 0:
        scope._llmresponse = content_list[0].get("text", "")
    else:
        scope._llmresponse = ""
    scope._response_id = response_dict.get("id")
    scope._response_model = request_model
    usage = response_dict.get("usage", {})
    billed = usage.get("billed_units", {})
    # Handle token usage including reasoning tokens and cached tokens
    scope._input_tokens = billed.get("input_tokens", 0)
    scope._output_tokens = billed.get("output_tokens", 0)
    scope._cache_read_input_tokens = 0  # Cohere does not expose cached tokens in API
    scope._cache_creation_input_tokens = 0
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._finish_reason = response_dict.get("finish_reason", "")

    # Handle tool calls
    if scope._kwargs.get("tools"):
        scope._tools = response_dict.get("message", {}).get("tool_calls")
        # Handle tool plan if present
        scope._tool_plan = response_dict.get("message", {}).get("tool_plan", "")
    else:
        scope._tools = None
        scope._tool_plan = ""

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


def common_embedding_logic(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
):
    """
    Process embedding request and generate Telemetry
    """

    request_model = scope._kwargs.get("model", "embed-english-v3.0")
    inputs = scope._kwargs.get("texts", [])

    cost = get_embed_model_cost(request_model, pricing_info, scope._input_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
        SemanticConvention.GEN_AI_SYSTEM_COHERE,
        scope._server_address,
        scope._server_port,
        request_model,
        scope._response_model,
        environment,
        application_name,
        False,
        0,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_ENCODING_FORMATS,
        scope._kwargs.get("embedding_types", ["float"]),
    )

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, scope._input_tokens
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE, scope._response_type
    )

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, str(inputs))

        # To be removed once the change to span_attributes (from span events) is complete
        scope._span.add_event(
            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
            attributes={
                SemanticConvention.GEN_AI_INPUT_MESSAGES: str(inputs),
            },
        )

    scope._span.set_status(Status(StatusCode.OK))

    # Metrics
    if not disable_metrics:
        record_embedding_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
            SemanticConvention.GEN_AI_SYSTEM_COHERE,
            scope._server_address,
            scope._server_port,
            request_model,
            scope._response_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            scope._input_tokens,
            cost,
        )


def process_embedding_response(
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
    **kwargs,
):
    """
    Process embedding request and generate Telemetry
    """

    # Create scope object
    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.time()
    scope._span = span
    scope._input_tokens = (
        response_dict.get("meta", {}).get("billed_units", {}).get("input_tokens", 0)
    )
    scope._response_model = request_model
    scope._response_type = response_dict.get("response_type", "")
    scope._ttft = scope._end_time - scope._start_time
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    common_embedding_logic(
        scope,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
    )

    return response
