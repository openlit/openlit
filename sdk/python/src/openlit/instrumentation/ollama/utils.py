"""
Ollama OpenTelemetry instrumentation utility functions
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    calculate_ttft,
    response_as_dict,
    calculate_tbt,
    general_tokens,
    get_chat_model_cost,
    get_embed_model_cost,
    create_metrics_attributes,
    common_span_attributes,
    record_completion_metrics,
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
        role = message["role"]
        content = message["content"]

        if isinstance(content, list):
            content_str = ", ".join(
                f"{item['type']}: {item['text'] if 'text' in item else item['image_url']}"
                if "type" in item
                else f"text: {item['text']}"
                for item in content
            )
            formatted_messages.append(f"{role}: {content_str}")
        else:
            formatted_messages.append(f"{role}: {content}")

    return "\n".join(formatted_messages)


def build_input_messages(messages):
    """
    Convert Ollama request messages to OTel input message structure.
    Follows gen-ai-input-messages schema.
    """
    structured_messages = []
    for msg in messages:
        role = msg.get("role", "user")
        parts = []
        content = msg.get("content", "")

        if isinstance(content, str):
            parts.append({"type": "text", "content": content})
        elif isinstance(content, list):
            for part in content:
                if part.get("type") == "text":
                    parts.append({"type": "text", "content": part.get("text", "")})
                elif part.get("type") == "image_url":
                    image_url = part.get("image_url", {}).get("url", "")
                    if not image_url.startswith("data:"):
                        parts.append(
                            {"type": "uri", "modality": "image", "uri": image_url}
                        )

        # Handle tool calls
        if "tool_calls" in msg:
            for tool_call in msg.get("tool_calls", []):
                parts.append(
                    {
                        "type": "tool_call",
                        "id": tool_call.get("id", ""),
                        "name": tool_call.get("function", {}).get("name", ""),
                        "arguments": tool_call.get("function", {}).get("arguments", {}),
                    }
                )

        # Handle tool responses
        if role == "tool" and "tool_call_id" in msg:
            parts.append(
                {
                    "type": "tool_call_response",
                    "id": msg.get("tool_call_id", ""),
                    "response": content,
                }
            )

        if parts:
            structured_messages.append({"role": role, "parts": parts})

    return structured_messages


def build_output_messages(response_text, finish_reason, tool_calls=None):
    """
    Convert Ollama response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    parts = []
    if response_text:
        parts.append({"type": "text", "content": response_text})

    if tool_calls:
        for tool_call in tool_calls:
            parts.append(
                {
                    "type": "tool_call",
                    "id": tool_call.get("id", ""),
                    "name": tool_call.get("function", {}).get("name", ""),
                    "arguments": tool_call.get("function", {}).get("arguments", {}),
                }
            )

    # Ollama uses done_reason field - map to OTel standard
    finish_reason_map = {
        "stop": "stop",
        "length": "max_tokens",
        "tool_calls": "tool_calls",
        "content_filter": "content_filter",
    }

    otel_finish_reason = finish_reason_map.get(finish_reason, finish_reason)
    return [{"role": "assistant", "parts": parts, "finish_reason": otel_finish_reason}]


def build_tool_definitions(tools):
    """
    Extract tool definitions from Ollama request.
    Returns tool definitions or None if not present.
    """
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

        # Map extra attributes to semantic conventions (include cache tokens even when 0)
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
            elif key in ("frequency_penalty", "repeat_penalty") and value is not None:
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


def process_chunk(self, chunk):
    """
    Process a chunk of response data and update state.
    """

    end_time = time.monotonic()
    # Record the timestamp for the current chunk
    self._timestamps.append(end_time)

    if len(self._timestamps) == 1:
        # Calculate time to first chunk
        self._ttft = calculate_ttft(self._timestamps, self._start_time)

    chunked = response_as_dict(chunk)
    self._llmresponse += chunked.get("message", {}).get("content", "")

    if chunked.get("message", {}).get("tool_calls"):
        self._tools = chunked["message"]["tool_calls"]

    if chunked.get("eval_count"):
        self._response_role = chunked.get("message", {}).get("role", "")
        # Handle token usage including reasoning tokens and cached tokens
        self._input_tokens = chunked.get("prompt_eval_count", 0)
        self._output_tokens = chunked.get("eval_count", 0)
        self._cache_read_input_tokens = 0  # Ollama does not expose cached tokens
        self._cache_creation_input_tokens = 0
        self._response_model = chunked.get("model", "")
        self._finish_reason = chunked.get("done_reason", "")


def record_embedding_metrics(
    metrics,
    gen_ai_operation,
    GEN_AI_PROVIDER_NAME,
    server_address,
    server_port,
    request_model,
    response_model,
    environment,
    application_name,
    start_time,
    end_time,
    cost,
    input_tokens,
):
    """
    Record embedding metrics for the operation.
    Delegates to the OTel-compliant helper function.
    """
    record_embedding_metrics(
        metrics=metrics,
        gen_ai_operation=gen_ai_operation,
        GEN_AI_PROVIDER_NAME=GEN_AI_PROVIDER_NAME,
        server_address=server_address,
        server_port=server_port,
        request_model=request_model,
        response_model=response_model,
        environment=environment,
        application_name=application_name,
        start_time=start_time,
        end_time=end_time,
        input_tokens=input_tokens,
        cost=cost,
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
    Process chat request and generate Telemetry
    """

    scope._end_time = time.monotonic()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)
    json_body = scope._kwargs.get("json", {}) or {}
    request_model = json_body.get("model") or scope._kwargs.get("model", "llama3.2")
    options = json_body.get("options", scope._kwargs.get("options", {}))

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
        scope._server_address,
        scope._server_port,
        request_model,
        getattr(scope, "_response_model", request_model),
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    request_attrs = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "repeat_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_tokens"),
        (SemanticConvention.GEN_AI_REQUEST_SEED, "seed"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stop"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
    ]
    for attribute, key in request_attrs:
        value = options.get(key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    # Span Attributes for Response parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Tools
    if getattr(scope, "_tools", None):
        tools = scope._tools if isinstance(scope._tools, list) else [scope._tools]
        tools = [t for t in tools if isinstance(t, dict) and t]
        if tools:
            names = [t.get("function", {}).get("name", "") for t in tools]
            ids = [str(t.get("id", "")) for t in tools]
            args = [str(t.get("function", {}).get("arguments", "")) for t in tools]
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

    # Span Attributes for Content (OTel: array structure for gen_ai.input.messages / gen_ai.output.messages)
    if capture_message_content:
        input_msgs = build_input_messages(
            json_body.get("messages", scope._kwargs.get("messages", []))
        )
        output_msgs = build_output_messages(
            scope._llmresponse, scope._finish_reason, scope._tools
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        # Emit inference event
        if event_provider:
            try:
                tool_defs = build_tool_definitions(
                    json_body.get("tools", scope._kwargs.get("tools"))
                )
                extra = {
                    "response_id": getattr(scope, "_response_id", None),
                    "finish_reasons": [scope._finish_reason],
                    "output_type": "text"
                    if isinstance(scope._llmresponse, str)
                    else "json",
                    "temperature": options.get("temperature"),
                    "max_tokens": options.get("max_tokens"),
                    "top_p": options.get("top_p"),
                    "top_k": options.get("top_k"),
                    "repeat_penalty": options.get("repeat_penalty"),
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
                    response_model=getattr(scope, "_response_model", request_model),
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
            SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
            scope._server_address,
            scope._server_port,
            request_model,
            getattr(scope, "_response_model", request_model),
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


def common_generate_logic(
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
    Process generate request and generate Telemetry
    """

    scope._end_time = time.monotonic()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)
    json_body = scope._kwargs.get("json", {}) or {}
    prompt = json_body.get("prompt")
    request_model = json_body.get("model") or scope._kwargs.get("model", "llama3.2")
    options = json_body.get("options", scope._kwargs.get("options", {}))

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
        SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
        scope._server_address,
        scope._server_port,
        request_model,
        getattr(scope, "_response_model", request_model),
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Request parameters
    request_attrs = [
        (SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY, "repeat_penalty"),
        (SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, "max_tokens"),
        (SemanticConvention.GEN_AI_REQUEST_SEED, "seed"),
        (SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, "stop"),
        (SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, "temperature"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_P, "top_p"),
        (SemanticConvention.GEN_AI_REQUEST_TOP_K, "top_k"),
    ]
    for attribute, key in request_attrs:
        value = options.get(key)
        if value is not None:
            scope._span.set_attribute(attribute, value)

    # Span Attributes for Response parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [scope._finish_reason]
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Tools
    if getattr(scope, "_tools", None):
        tools = scope._tools if isinstance(scope._tools, list) else [scope._tools]
        tools = [t for t in tools if isinstance(t, dict) and t]
        if tools:
            names = [t.get("function", {}).get("name", "") for t in tools]
            ids = [str(t.get("id", "")) for t in tools]
            args = [str(t.get("function", {}).get("arguments", "")) for t in tools]
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

    # Span Attributes for Content (OTel: array structure for gen_ai.input.messages / gen_ai.output.messages)
    if capture_message_content:
        input_msgs = [
            {"role": "user", "parts": [{"type": "text", "content": prompt or ""}]}
        ]
        output_msgs = build_output_messages(
            scope._llmresponse, scope._finish_reason, scope._tools
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        # Emit inference event
        if event_provider:
            try:
                tool_defs = build_tool_definitions(
                    json_body.get("tools", scope._kwargs.get("tools"))
                )
                extra = {
                    "response_id": getattr(scope, "_response_id", None),
                    "finish_reasons": [scope._finish_reason],
                    "output_type": "text"
                    if isinstance(scope._llmresponse, str)
                    else "json",
                    "temperature": options.get("temperature"),
                    "max_tokens": options.get("max_tokens"),
                    "top_p": options.get("top_p"),
                    "top_k": options.get("top_k"),
                    "repeat_penalty": options.get("repeat_penalty"),
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
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
                    request_model=request_model,
                    response_model=getattr(scope, "_response_model", request_model),
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
            SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
            SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
            scope._server_address,
            scope._server_port,
            request_model,
            getattr(scope, "_response_model", request_model),
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


def common_embedding_logic(
    scope,
    gen_ai_endpoint,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """
    Process embedding request and generate Telemetry
    """

    json_body = scope._kwargs.get("json", {}) or {}
    request_model = json_body.get("model") or scope._kwargs.get("model", "llama3.2")
    prompt_val = json_body.get("prompt", scope._kwargs.get("prompt", ""))
    input_tokens = general_tokens(str(prompt_val))
    is_stream = False  # Ollama embeddings are not streaming

    cost = get_embed_model_cost(request_model, pricing_info, input_tokens)

    # Common Span Attributes
    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
        SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
        scope._server_address,
        scope._server_port,
        request_model,
        request_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    # Span Attributes for Embedding-specific parameters
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, input_tokens
    )

    # Span Attributes for Cost
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Span Attributes for Content
    if capture_message_content:
        scope._span.set_attribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, prompt_val)

        # Emit inference event
        if event_provider:
            try:
                if isinstance(prompt_val, str):
                    input_text = [prompt_val]
                elif isinstance(prompt_val, list):
                    input_text = prompt_val
                else:
                    input_text = [str(prompt_val)]
                input_msgs = [
                    {"role": "user", "parts": [{"type": "text", "content": text}]}
                    for text in input_text
                ]
                emit_inference_event(
                    event_provider=event_provider,
                    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
                    request_model=request_model,
                    response_model=request_model,
                    input_messages=input_msgs,
                    output_messages=[],
                    tool_definitions=None,
                    server_address=scope._server_address,
                    server_port=scope._server_port,
                    input_tokens=input_tokens,
                )
            except Exception as e:
                logger.warning("Failed to emit inference event: %s", e, exc_info=True)

    scope._span.set_status(Status(StatusCode.OK))

    # Metrics
    if not disable_metrics:
        record_embedding_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
            SemanticConvention.GEN_AI_SYSTEM_OLLAMA,
            scope._server_address,
            scope._server_port,
            request_model,
            request_model,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            cost,
            input_tokens,
        )


def process_streaming_chat_response(
    self,
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
        self,
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

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.monotonic()
    scope._span = span
    scope._llmresponse = response_dict.get("message", {}).get("content", "")
    scope._response_role = response_dict.get("message", {}).get("role", "assistant")
    # Handle token usage including reasoning tokens and cached tokens
    scope._input_tokens = response_dict.get("prompt_eval_count", 0)
    scope._output_tokens = response_dict.get("eval_count", 0)
    scope._cache_read_input_tokens = 0  # Ollama does not expose cached tokens
    scope._cache_creation_input_tokens = 0
    scope._response_model = response_dict.get("model", "llama3.2")
    scope._finish_reason = response_dict.get("done_reason", "")
    scope._timestamps = []
    scope._ttft = scope._end_time - scope._start_time
    scope._tbt = 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    if scope._kwargs.get("tools"):
        scope._tools = response_dict.get("message", {}).get("tool_calls")
    else:
        scope._tools = None

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


def process_streaming_generate_response(
    self,
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
    Process streaming generate request and generate Telemetry
    """

    common_generate_logic(
        self,
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


def process_generate_response(
    response,
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
    Process generate request and generate Telemetry
    """

    scope = type("GenericScope", (), {})()
    response_dict = response_as_dict(response)

    scope._start_time = start_time
    scope._end_time = time.monotonic()
    scope._span = span
    scope._llmresponse = response_dict.get("response", "")
    scope._response_role = response_dict.get("message", {}).get("role", "assistant")
    # Handle token usage including reasoning tokens and cached tokens
    scope._input_tokens = response_dict.get("prompt_eval_count", 0)
    scope._output_tokens = response_dict.get("eval_count", 0)
    scope._cache_read_input_tokens = 0  # Ollama does not expose cached tokens
    scope._cache_creation_input_tokens = 0
    scope._response_model = response_dict.get("model", "llama3.2")
    scope._finish_reason = response_dict.get("done_reason", "")
    scope._timestamps = []
    scope._ttft = scope._end_time - scope._start_time
    scope._tbt = 0
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    # Ollama generate response shape: no message.tool_calls in standard response
    scope._tools = None

    common_generate_logic(
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


def process_embedding_response(
    response,
    gen_ai_endpoint,
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
    Process embedding request and generate Telemetry
    """

    scope = type("GenericScope", (), {})()

    scope._start_time = start_time
    scope._end_time = time.monotonic()
    scope._span = span
    scope._server_address, scope._server_port = server_address, server_port
    scope._kwargs = kwargs

    # Initialize streaming and timing values for Ollama embeddings
    scope._response_model = kwargs.get("model", "llama3.2")
    scope._tbt = 0.0
    scope._ttft = scope._end_time - scope._start_time

    common_embedding_logic(
        scope,
        gen_ai_endpoint,
        pricing_info,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        event_provider,
    )

    return response
