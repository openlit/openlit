"""
Mistral OpenTelemetry instrumentation utility functions
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
    otel_event,
    record_completion_metrics,
    record_embedding_metrics,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(messages):
    """
    Process a list of messages to extract content.
    """

    formatted_messages = []
    for message in messages:
        role = message.get("role", "user")
        content = message.get("content", "")

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
    Convert Mistral request messages to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    if not messages:
        return []
    if isinstance(messages, str):
        return [{"role": "user", "parts": [{"type": "text", "content": messages}]}]
    otel_messages = []
    for message in messages:
        try:
            role = message.get("role", "user")
            content = message.get("content", "")
            parts = []
            if isinstance(content, list):
                for item in content:
                    if not isinstance(item, dict):
                        continue
                    item_type = item.get("type")
                    if item_type == "text":
                        text_content = item.get("text", "")
                        if text_content:
                            parts.append({"type": "text", "content": text_content})
                    elif item_type == "image_url":
                        image_url_obj = item.get("image_url", {})
                        url = (
                            image_url_obj.get("url", "")
                            if isinstance(image_url_obj, dict)
                            else ""
                        )
                        if url and not url.startswith("data:"):
                            parts.append(
                                {"type": "uri", "modality": "image", "uri": url}
                            )
            elif isinstance(content, str) and content:
                parts.append({"type": "text", "content": content})
            if parts:
                otel_messages.append({"role": role, "parts": parts})
        except Exception as e:
            logger.warning("Failed to process input message: %s", e, exc_info=True)
            continue
    return otel_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Mistral response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    parts = []
    try:
        if response_text:
            parts.append({"type": "text", "content": str(response_text)})
        if tool_calls and isinstance(tool_calls, list):
            for tool_call in tool_calls:
                try:
                    if isinstance(tool_call, dict):
                        func = tool_call.get("function", {})
                        tool_id = tool_call.get("id", "")
                        tool_name = func.get("name", "")
                        tool_args = func.get("arguments", {})
                    else:
                        tool_id = getattr(tool_call, "id", "")
                        func = getattr(tool_call, "function", {}) or {}
                        tool_name = (
                            func.get("name", "")
                            if isinstance(func, dict)
                            else getattr(func, "name", "")
                        )
                        tool_args = (
                            func.get("arguments", "")
                            if isinstance(func, dict)
                            else getattr(func, "arguments", "")
                        )
                    if isinstance(tool_args, str):
                        try:
                            tool_args = json.loads(tool_args)
                        except Exception:
                            tool_args = {"raw": tool_args}
                    parts.append(
                        {
                            "type": "tool_call",
                            "id": tool_id,
                            "name": tool_name,
                            "arguments": tool_args,
                        }
                    )
                except Exception as e:
                    logger.warning("Failed to process tool call: %s", e, exc_info=True)
        finish_reason_map = {
            "stop": "stop",
            "length": "length",
            "content_filter": "content_filter",
            "tool_calls": "tool_call",
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
            if value is not None:
                if key == "response_id":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = value
                elif key == "finish_reasons":
                    attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = value
                elif key == "output_type":
                    attributes[SemanticConvention.GEN_AI_OUTPUT_TYPE] = value
                elif key == "conversation_id":
                    attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = value
                elif key == "temperature":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TEMPERATURE] = value
                elif key == "max_tokens":
                    attributes[SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS] = value
                elif key == "top_p":
                    attributes[SemanticConvention.GEN_AI_REQUEST_TOP_P] = value
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
                elif key == "cache_creation_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS
                    ] = value
                elif key == "cache_read_input_tokens":
                    attributes[
                        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS
                    ] = value
                elif key == "error_type":
                    attributes[SemanticConvention.ERROR_TYPE] = value
                elif key == "system_instructions":
                    attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
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
    # Record the timestamp for the current chunk
    scope._timestamps.append(end_time)

    if len(scope._timestamps) == 1:
        # Calculate time to first chunk
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    chunked = response_as_dict(chunk)

    # Collect message IDs and aggregated response from events
    if chunked.get("data"):
        data = chunked.get("data")
        choices = data.get("choices", [])

        if choices and "delta" in choices[0]:
            delta = choices[0]["delta"]
            content = delta.get("content")
            if content:
                scope._llmresponse += content

            # Handle tool calls in streaming - optimized
            delta_tools = delta.get("tool_calls")
            if delta_tools:
                scope._tools = scope._tools or []

                for tool in delta_tools:
                    idx = tool.get("index", 0)

                    # Extend list if needed
                    scope._tools.extend([{}] * (idx + 1 - len(scope._tools)))

                    if tool.get("id"):  # New tool (id exists)
                        func = tool.get("function", {})
                        scope._tools[idx] = {
                            "id": tool["id"],
                            "function": {
                                "name": func.get("name", ""),
                                "arguments": func.get("arguments", ""),
                            },
                            "type": tool.get("type", "function"),
                        }
                    elif (
                        scope._tools[idx] and "function" in tool
                    ):  # Append args (id is None)
                        scope._tools[idx]["function"]["arguments"] += tool[
                            "function"
                        ].get("arguments", "")

        # Handle usage information (typically only in final chunk)
        if data.get("usage"):
            usage = data.get("usage")
            scope._input_tokens = usage.get("prompt_tokens", 0)
            scope._output_tokens = usage.get("completion_tokens", 0)
            scope._response_id = data.get("id")
            scope._response_model = data.get("model")
            scope._finish_reason = (
                choices[0].get("finish_reason", "") if choices else ""
            )
            scope._end_time = time.time()
            # Handle token usage including reasoning tokens and cached tokens
            input_tokens_details = usage.get("input_tokens_details") or usage.get(
                "prompt_tokens_details", {}
            )
            scope._cache_read_input_tokens = input_tokens_details.get(
                "cached_tokens", 0
            )
            scope._cache_creation_input_tokens = usage.get(
                "cache_creation_input_tokens", 0
            )


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
    Process chat request and generate Telemetry.
    """

    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    prompt = format_content(scope._kwargs.get("messages", []))
    request_model = scope._kwargs.get("model", "mistral-small-latest")

    # Compute cost
    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_MISTRAL,
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

    # Mistral chat (no additional API type attribute)

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

    # Span Attributes for Content
    if capture_message_content:
        input_msgs = build_input_messages(scope._kwargs.get("messages", []))
        output_msgs = build_output_messages(
            scope._llmresponse, scope._finish_reason, scope._tools
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        if event_provider:
            try:
                extra = {
                    "response_id": scope._response_id,
                    "finish_reasons": [scope._finish_reason],
                    "output_type": "text"
                    if isinstance(scope._llmresponse, str)
                    else "json",
                    "temperature": scope._kwargs.get("temperature", 0.3),
                    "max_tokens": scope._kwargs.get("max_tokens", -1),
                    "top_p": scope._kwargs.get("p", 1.0),
                    "frequency_penalty": scope._kwargs.get("frequency_penalty", 0.0),
                    "presence_penalty": scope._kwargs.get("presence_penalty", 0.0),
                    "stop_sequences": scope._kwargs.get("stop_sequences", []),
                    "seed": scope._kwargs.get("seed", ""),
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
                    tool_definitions=None,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    **extra,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    # Span status and metrics
    scope._span.set_status(Status(StatusCode.OK))
    if not disable_metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_MISTRAL,
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
    scope._llmresponse = " ".join(
        (choice.get("message", {}).get("content") or "")
        for choice in response_dict.get("choices", [])
    )
    scope._response_id = response_dict.get("id")
    scope._response_model = response_dict.get("model")
    scope._input_tokens = response_dict.get("usage", {}).get("prompt_tokens", 0)
    scope._output_tokens = response_dict.get("usage", {}).get("completion_tokens", 0)
    scope._timestamps = []
    scope._ttft, scope._tbt = scope._end_time - scope._start_time, 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs
    scope._finish_reason = (
        str(response_dict.get("choices", [])[0].get("finish_reason", ""))
        if response_dict.get("choices")
        else ""
    )

    # Handle tool calls
    if kwargs.get("tools"):
        scope._tools = (
            response_dict.get("choices", [{}])[0].get("message", {}).get("tool_calls")
        )
    else:
        scope._tools = None

    # Handle token usage including reasoning tokens and cached tokens
    usage = response_dict.get("usage", {})
    input_tokens_details = usage.get("input_tokens_details") or usage.get(
        "prompt_tokens_details", {}
    )
    scope._cache_read_input_tokens = input_tokens_details.get("cached_tokens", 0)
    scope._cache_creation_input_tokens = usage.get("cache_creation_input_tokens", 0)

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

    request_model = scope._kwargs.get("model", "mistral-embed")
    inputs = scope._kwargs.get("inputs", [])

    cost = get_embed_model_cost(request_model, pricing_info, scope._input_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
        SemanticConvention.GEN_AI_SYSTEM_MISTRAL,
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
        [scope._kwargs.get("encoding_format", "float")],
    )

    # Span Attributes for Cost and Tokens
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, scope._input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, scope._input_tokens
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

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
            SemanticConvention.GEN_AI_SYSTEM_MISTRAL,
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
    scope._response_model = response_dict.get("model")
    scope._input_tokens = response_dict.get("usage", {}).get("prompt_tokens", 0)
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
