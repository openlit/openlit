"""
DigitalOcean Gradient SDK OpenTelemetry instrumentation utility functions.

The Gradient SDK is OpenAI-style: flat kwargs at the resource layer, Pydantic
response models, and SSE streaming via gradient._streaming.{Stream, AsyncStream}.
"""

import json
import logging
import time

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    apply_agent_version_attributes,
    build_system_instructions_from_messages,
    calculate_ttft,
    calculate_tbt,
    common_span_attributes,
    general_tokens,
    get_chat_model_cost,
    get_image_model_cost,
    otel_event,
    record_completion_metrics,
    response_as_dict,
    truncate_message_content,
)
from openlit._config import OpenlitConfig
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


_FINISH_REASON_MAP = {
    "stop": "stop",
    "length": "length",
    "content_filter": "content_filter",
    "tool_calls": "tool_call",
    "function_call": "tool_call",
    "end_turn": "stop",
    "max_tokens": "length",
    "stop_sequence": "stop",
    "tool_use": "tool_call",
}


def _parse_args(value):
    """Parse JSON-string arguments into structured form when possible.

    OpenAI-style SDKs encode `function.arguments` as a JSON string.
    The OTel `tool_call` part schema specifies `arguments` as `any` —
    consumers expect the parsed object, not a JSON-encoded string.
    """
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return s
        try:
            return json.loads(s)
        except (ValueError, TypeError):
            return value
    return value


def _tool_call_part(tool_id, name, arguments):
    """Build a spec-compliant `tool_call` part. Drops empty optional fields."""
    part = {"type": "tool_call", "name": name or ""}
    if tool_id:
        part["id"] = str(tool_id)
    parsed = _parse_args(arguments)
    if parsed is not None and parsed != "":
        part["arguments"] = parsed
    return part


def _tool_response_part(tool_id, response):
    """Build a spec-compliant `tool_call_response` part."""
    part = {"type": "tool_call_response", "response": response}
    if tool_id:
        part["id"] = str(tool_id)
    return part


def _build_tool_definitions(tools):
    """Convert OpenAI-style `tools` array into spec §10.4 flattened shape."""
    if not isinstance(tools, list):
        return None
    out = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        ttype = tool.get("type", "function")
        if ttype == "function" and isinstance(tool.get("function"), dict):
            fn = tool["function"]
            entry = {"type": "function", "name": fn.get("name", "")}
            if fn.get("description"):
                entry["description"] = fn["description"]
            if fn.get("parameters") is not None:
                entry["parameters"] = fn["parameters"]
            out.append(entry)
        else:
            entry = {"type": ttype, "name": tool.get("name", "")}
            for key in ("description", "parameters"):
                if tool.get(key) is not None:
                    entry[key] = tool[key]
            out.append(entry)
    return out or None


def format_content(messages):
    """Flatten messages to a single string for token estimation fallback."""
    if not messages:
        return ""
    formatted = []
    for message in messages:
        role = (
            message.get("role", "user")
            if isinstance(message, dict)
            else getattr(message, "role", "user")
        )
        content = (
            message.get("content", "")
            if isinstance(message, dict)
            else getattr(message, "content", "")
        )
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    if "text" in item:
                        parts.append(item["text"])
                    elif item.get("type") == "image_url":
                        parts.append("[image]")
            formatted.append(f"{role}: {', '.join(parts)}")
        else:
            formatted.append(f"{role}: {content}")
    return "\n".join(formatted)


def build_input_messages(messages):
    """Convert request messages into the OTel `gen_ai.input.messages` schema."""
    if not messages:
        return []
    out = []
    for message in messages:
        try:
            role = (
                message.get("role", "user")
                if isinstance(message, dict)
                else getattr(message, "role", "user")
            )
            content = (
                message.get("content", "")
                if isinstance(message, dict)
                else getattr(message, "content", "")
            )
            parts = []
            if isinstance(content, list):
                for item in content:
                    if not isinstance(item, dict):
                        continue
                    item_type = item.get("type")
                    if item_type == "text" and item.get("text"):
                        parts.append({"type": "text", "content": item["text"]})
                    elif item_type == "image_url":
                        url = (item.get("image_url") or {}).get("url", "")
                        if url and not str(url).startswith("data:"):
                            parts.append(
                                {"type": "uri", "modality": "image", "uri": url}
                            )
            elif isinstance(content, str) and content:
                parts.append({"type": "text", "content": content})

            # OpenAI-style assistant message with tool_calls array
            if role == "assistant" and isinstance(message, dict):
                for tc in message.get("tool_calls") or []:
                    if not isinstance(tc, dict):
                        continue
                    fn = tc.get("function") or {}
                    parts.append(
                        _tool_call_part(
                            tc.get("id"),
                            fn.get("name", ""),
                            fn.get("arguments"),
                        )
                    )

            if role == "tool":
                tool_call_id = (
                    message.get("tool_call_id")
                    if isinstance(message, dict)
                    else getattr(message, "tool_call_id", None)
                )
                tool_content = content if isinstance(content, str) else str(content)
                parts = [_tool_response_part(tool_call_id, tool_content)]

            if parts:
                out.append({"role": role, "parts": parts})
        except Exception as exc:
            logger.warning("Failed to process input message: %s", exc, exc_info=True)
    return out


def build_output_messages(
    response_text, finish_reason, tool_calls=None, reasoning=None
):
    """Build the OTel `gen_ai.output.messages` array from accumulated response state."""
    parts = []
    try:
        if reasoning:
            parts.append({"type": "reasoning", "content": reasoning})
        if response_text:
            parts.append({"type": "text", "content": response_text})
        if tool_calls:
            tools = tool_calls if isinstance(tool_calls, list) else [tool_calls]
            for tool in tools:
                if not isinstance(tool, dict):
                    continue
                fn = tool.get("function") or {}
                parts.append(
                    _tool_call_part(
                        tool.get("id"),
                        fn.get("name", ""),
                        fn.get("arguments"),
                    )
                )
        otel_finish = _FINISH_REASON_MAP.get(finish_reason, finish_reason or "stop")
        return [{"role": "assistant", "parts": parts, "finish_reason": otel_finish}]
    except Exception as exc:
        logger.warning("Failed to build output messages: %s", exc, exc_info=True)
        return [{"role": "assistant", "parts": [], "finish_reason": "stop"}]


def _set_span_messages_as_array(span, input_messages, output_messages):
    try:
        truncate_message_content(input_messages)
        truncate_message_content(output_messages)
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
    except Exception as exc:
        logger.warning("Failed to set span message attributes: %s", exc, exc_info=True)


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
    **extra,
):
    """Emit the `gen_ai.client.inference.operation.details` event."""
    if not event_provider:
        return
    try:
        attributes = {SemanticConvention.GEN_AI_OPERATION: operation_name}
        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if response_model:
            attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = response_model
        if server_address:
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port is not None:
            attributes[SemanticConvention.SERVER_PORT] = server_port
        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages
        if tool_definitions is not None:
            attributes[SemanticConvention.GEN_AI_TOOL_DEFINITIONS] = tool_definitions
        for key, value in extra.items():
            if value is None:
                continue
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
            elif key == "input_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = value
            elif key == "output_tokens":
                attributes[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = value
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
        if not OpenlitConfig.disable_events:
            event_provider.emit(event)
    except Exception as exc:
        logger.warning("Failed to emit inference event: %s", exc, exc_info=True)


def _normalize_stop(stop):
    if stop is None:
        return []
    if isinstance(stop, str):
        return [stop]
    if isinstance(stop, list):
        return stop
    return [str(stop)]


# ---------------------------------------------------------------------------
# Streaming chunk processors
# ---------------------------------------------------------------------------


def process_chunk(scope, chunk):
    """Chat-completions chunk handler (Gradient OpenAI-compatible)."""
    end_time = time.time()
    scope._timestamps.append(end_time)
    if len(scope._timestamps) == 1:
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    chunked = response_as_dict(chunk)

    choices = chunked.get("choices") or []
    if choices:
        choice0 = choices[0]
        delta = choice0.get("delta") or {}
        content = delta.get("content")
        if content:
            scope._llmresponse += content
        finish = choice0.get("finish_reason")
        if finish:
            scope._finish_reason = finish

        delta_tools = delta.get("tool_calls")
        if delta_tools:
            scope._tools = scope._tools or []
            for tool in delta_tools:
                idx = tool.get("index", 0) or 0
                while len(scope._tools) <= idx:
                    scope._tools.append({})
                if tool.get("id"):
                    scope._tools[idx] = {
                        "id": tool["id"],
                        "type": tool.get("type", "function"),
                        "function": {
                            "name": (tool.get("function") or {}).get("name") or "",
                            "arguments": (tool.get("function") or {}).get("arguments")
                            or "",
                        },
                    }
                elif scope._tools[idx]:
                    fn = tool.get("function") or {}
                    if "function" not in scope._tools[idx]:
                        scope._tools[idx]["function"] = {"name": "", "arguments": ""}
                    scope._tools[idx]["function"]["arguments"] += (
                        fn.get("arguments") or ""
                    )
                    if fn.get("name"):
                        scope._tools[idx]["function"]["name"] = fn["name"]

    if chunked.get("id"):
        scope._response_id = chunked["id"]
    if chunked.get("model"):
        scope._response_model = chunked["model"]

    usage = chunked.get("usage")
    if usage:
        scope._input_tokens = usage.get("prompt_tokens") or scope._input_tokens
        scope._output_tokens = usage.get("completion_tokens") or scope._output_tokens


def process_response_chunk(scope, chunk):
    """Responses-API chunk handler."""
    end_time = time.time()
    scope._timestamps.append(end_time)
    if len(scope._timestamps) == 1:
        scope._ttft = calculate_ttft(scope._timestamps, scope._start_time)

    chunked = response_as_dict(chunk)
    chunk_type = chunked.get("type") or chunked.get("object")

    if chunk_type and "output_text.delta" in chunk_type:
        delta = chunked.get("delta", "")
        if isinstance(delta, str):
            scope._llmresponse += delta
    elif chunk_type and "reasoning_text.delta" in chunk_type:
        delta = chunked.get("delta", "")
        if isinstance(delta, str):
            scope._reasoning_text = getattr(scope, "_reasoning_text", "") + delta

    response = chunked.get("response")
    if isinstance(response, dict):
        scope._response_id = response.get("id") or scope._response_id
        scope._response_model = response.get("model") or scope._response_model
        usage = response.get("usage") or {}
        scope._input_tokens = usage.get("input_tokens", scope._input_tokens)
        scope._output_tokens = usage.get("output_tokens", scope._output_tokens)
        details = usage.get("output_tokens_details") or {}
        scope._reasoning_tokens = details.get(
            "reasoning_tokens", getattr(scope, "_reasoning_tokens", 0)
        )


# ---------------------------------------------------------------------------
# Common attribute setter (chat / responses / agent-chat)
# ---------------------------------------------------------------------------


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
    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    api_type=None,
    event_provider=None,
):
    """Set span attributes, emit event, record metrics for chat-style operations."""
    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    body = scope._body or {}
    request_model = body.get("model", "unknown")

    if not scope._input_tokens:
        scope._input_tokens = general_tokens(format_content(body.get("messages", [])))
    if not scope._output_tokens:
        scope._output_tokens = general_tokens(scope._llmresponse or "")

    cost = get_chat_model_cost(
        request_model, pricing_info, scope._input_tokens, scope._output_tokens
    )

    common_span_attributes(
        scope,
        operation_name,
        SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
        scope._server_address,
        scope._server_port,
        request_model,
        getattr(scope, "_response_model", request_model) or request_model,
        environment,
        application_name,
        is_stream,
        scope._tbt,
        scope._ttft,
        version,
    )

    if body.get("temperature") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, body["temperature"]
        )
    if body.get("top_p") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_TOP_P, body["top_p"]
        )
    max_tokens = body.get("max_completion_tokens") or body.get("max_tokens")
    if max_tokens is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, max_tokens
        )
    if body.get("frequency_penalty") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
            body["frequency_penalty"],
        )
    if body.get("presence_penalty") is not None:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
            body["presence_penalty"],
        )
    stop_sequences = _normalize_stop(body.get("stop") or body.get("stop_sequences"))
    if stop_sequences:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, stop_sequences
        )
    if body.get("seed") is not None:
        scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_SEED, body["seed"])
    n_choices = body.get("n")
    if n_choices is not None and n_choices != 1:
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_CHOICE_COUNT, n_choices
        )
    if body.get("user"):
        scope._span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER, body["user"])
    if body.get("reasoning_effort"):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_REQUEST_REASONING_EFFORT,
            body["reasoning_effort"],
        )

    if getattr(scope, "_response_id", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    if getattr(scope, "_finish_reason", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
            [_FINISH_REASON_MAP.get(scope._finish_reason, scope._finish_reason)],
        )
    output_type = (
        "json"
        if (body.get("response_format") or {}).get("type") == "json_object"
        else "text"
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, output_type)
    if api_type:
        scope._span.set_attribute(SemanticConvention.OPENAI_API_TYPE, api_type)

    if scope._tools:
        first = scope._tools[0] if isinstance(scope._tools, list) else scope._tools
        if isinstance(first, dict):
            fn = first.get("function") or {}
            if fn.get("name"):
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_NAME, fn.get("name", "")
                )
            if first.get("id"):
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_ID, str(first.get("id", ""))
                )
            if capture_message_content and fn.get("arguments"):
                args_val = fn.get("arguments")
                if not isinstance(args_val, str):
                    try:
                        args_val = json.dumps(args_val)
                    except (TypeError, ValueError):
                        args_val = str(args_val)
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS, args_val
                )

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
    if getattr(scope, "_reasoning_tokens", 0):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, scope._reasoning_tokens
        )

    if is_stream and scope._ttft:
        scope._span.set_attribute("gen_ai.response.time_to_first_chunk", scope._ttft)

    # Compute system instructions + tool definitions unconditionally so the
    # agent version hash is stable across content-capture toggles.
    system_instr = build_system_instructions_from_messages(body.get("messages", []))
    tool_defs = _build_tool_definitions(body.get("tools"))

    version_extras = apply_agent_version_attributes(
        scope._span,
        system_instructions=system_instr,
        tool_definitions=tool_defs,
        primary_model=getattr(scope, "_response_model", None) or request_model,
        runtime_config={
            "temperature": body.get("temperature"),
            "top_p": body.get("top_p"),
            "max_tokens": max_tokens,
            "provider": SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
        },
        providers=[SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN],
    )

    # Build messages regardless of capture so the inference event below can
    # still emit metadata.
    input_msgs = build_input_messages(body.get("messages", []))
    output_msgs = build_output_messages(
        scope._llmresponse,
        scope._finish_reason,
        tool_calls=scope._tools,
        reasoning=getattr(scope, "_reasoning_text", "") or None,
    )

    if capture_message_content:
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)
        if system_instr:
            scope._span.set_attribute(
                SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                json.dumps(system_instr),
            )
        if tool_defs:
            try:
                scope._span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_DEFINITIONS,
                    json.dumps(tool_defs),
                )
            except (TypeError, ValueError):
                pass

    # Emit inference event independently of content capture.
    if event_provider:
        emit_kwargs = {
            "event_provider": event_provider,
            "operation_name": operation_name,
            "request_model": request_model,
            "response_model": getattr(scope, "_response_model", request_model)
            or request_model,
            "input_messages": input_msgs if capture_message_content else [],
            "output_messages": output_msgs if capture_message_content else [],
            "tool_definitions": tool_defs,
            "server_address": scope._server_address,
            "server_port": scope._server_port,
            "response_id": getattr(scope, "_response_id", None),
            "finish_reasons": [
                _FINISH_REASON_MAP.get(
                    scope._finish_reason, scope._finish_reason or "stop"
                )
            ],
            "output_type": output_type,
            "temperature": body.get("temperature"),
            "max_tokens": max_tokens,
            "top_p": body.get("top_p"),
            "input_tokens": scope._input_tokens,
            "output_tokens": scope._output_tokens,
            **version_extras,
        }
        if capture_message_content and system_instr:
            emit_kwargs["system_instructions"] = system_instr
        emit_inference_event(**emit_kwargs)

    scope._span.set_status(Status(StatusCode.OK))

    if not disable_metrics and metrics:
        inter_chunk_durations = None
        if len(scope._timestamps) > 1:
            inter_chunk_durations = [
                scope._timestamps[i] - scope._timestamps[i - 1]
                for i in range(1, len(scope._timestamps))
            ]
        record_completion_metrics(
            metrics,
            operation_name,
            SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
            scope._server_address,
            scope._server_port,
            request_model,
            getattr(scope, "_response_model", request_model) or request_model,
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


def _new_scope(body, span, start_time, server_address, server_port, response_dict=None):
    scope = type("GradientScope", (), {})()
    scope._body = body
    scope._span = span
    scope._start_time = start_time
    scope._end_time = time.time()
    scope._server_address = server_address
    scope._server_port = server_port
    scope._llmresponse = ""
    scope._reasoning_text = ""
    scope._response_id = ""
    scope._response_model = ""
    scope._finish_reason = ""
    scope._tools = None
    scope._timestamps = []
    scope._ttft = 0
    scope._tbt = 0
    scope._input_tokens = 0
    scope._output_tokens = 0
    scope._reasoning_tokens = 0
    if response_dict is not None:
        scope._response_id = response_dict.get("id", "") or ""
        scope._response_model = response_dict.get("model", "") or ""
    return scope


# ---------------------------------------------------------------------------
# Non-streaming response processors
# ---------------------------------------------------------------------------


def process_chat_response(
    response,
    body,
    pricing_info,
    server_address,
    server_port,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """Non-streaming chat completion processor."""
    response_dict = response_as_dict(response)
    scope = _new_scope(
        body, span, start_time, server_address, server_port, response_dict
    )

    choices = response_dict.get("choices") or []
    if choices:
        choice0 = choices[0]
        message = choice0.get("message") or {}
        content = message.get("content") or ""
        scope._llmresponse = content if isinstance(content, str) else str(content)
        scope._finish_reason = choice0.get("finish_reason") or ""
        if message.get("tool_calls"):
            scope._tools = message["tool_calls"]

    usage = response_dict.get("usage") or {}
    scope._input_tokens = usage.get("prompt_tokens", 0) or 0
    scope._output_tokens = usage.get("completion_tokens", 0) or 0

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
        operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        api_type="chat",
        event_provider=event_provider,
    )
    return response


def process_streaming_chat_response(
    scope,
    pricing_info,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
    operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    api_type="chat",
):
    """Finalize a streaming chat (or responses) span by delegating to common_chat_logic."""
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
        operation_name=operation_name,
        api_type=api_type,
        event_provider=event_provider,
    )


def process_responses_response(
    response,
    body,
    pricing_info,
    server_address,
    server_port,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """Non-streaming Responses-API processor (OpenAI Responses surface)."""
    response_dict = response_as_dict(response)
    scope = _new_scope(
        body, span, start_time, server_address, server_port, response_dict
    )

    output_text = []
    reasoning_text = []
    tool_calls = []
    finish = ""
    for item in response_dict.get("output") or []:
        if not isinstance(item, dict):
            continue
        finish = item.get("status") or finish
        if item.get("type") == "message":
            for content in item.get("content") or []:
                if not isinstance(content, dict):
                    continue
                if content.get("type") == "output_text" and content.get("text"):
                    output_text.append(content["text"])
                elif content.get("type") == "reasoning_text" and content.get("text"):
                    reasoning_text.append(content["text"])
        elif item.get("type") == "function_call":
            tool_calls.append(
                {
                    "id": item.get("call_id", ""),
                    "type": "function",
                    "function": {
                        "name": item.get("name", ""),
                        "arguments": item.get("arguments", ""),
                    },
                }
            )

    scope._llmresponse = "".join(output_text)
    scope._reasoning_text = "".join(reasoning_text)
    scope._finish_reason = finish
    if tool_calls:
        scope._tools = tool_calls

    usage = response_dict.get("usage") or {}
    scope._input_tokens = usage.get("input_tokens", 0) or 0
    scope._output_tokens = usage.get("output_tokens", 0) or 0
    details = usage.get("output_tokens_details") or {}
    scope._reasoning_tokens = details.get("reasoning_tokens", 0) or 0

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
        operation_name=SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        api_type="responses",
        event_provider=event_provider,
    )
    return response


# ---------------------------------------------------------------------------
# Image generation
# ---------------------------------------------------------------------------


def process_image_response(
    response,
    body,
    pricing_info,
    server_address,
    server_port,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """Non-streaming image-generation response processor."""
    end_time = time.time()
    response_dict = response_as_dict(response)
    request_model = body.get("model", "unknown")
    response_model = response_dict.get("model") or request_model
    size = body.get("size", "1024x1024")
    quality = body.get("quality", "standard")

    cost = get_image_model_cost(request_model, pricing_info, size, quality)

    scope = _new_scope(
        body, span, start_time, server_address, server_port, response_dict
    )
    scope._end_time = end_time

    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
        server_address,
        server_port,
        request_model,
        response_model,
        environment,
        application_name,
        False,
        0,
        0,
        version,
    )
    span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "image")
    if response_dict.get("created"):
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, str(response_dict["created"])
        )
    span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    if capture_message_content:
        prompt = body.get("prompt", "")
        input_msgs = (
            [
                {
                    "role": "user",
                    "parts": [{"type": "text", "content": str(prompt)}],
                }
            ]
            if prompt
            else None
        )
        _set_span_messages_as_array(span, input_msgs, None)

    span.set_status(Status(StatusCode.OK))

    if not disable_metrics and metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
            server_address,
            server_port,
            request_model,
            response_model,
            environment,
            application_name,
            start_time,
            end_time,
            0,
            0,
            cost,
            None,
            None,
        )
    return response


# ---------------------------------------------------------------------------
# Knowledge-base retrieval (RAG)
# ---------------------------------------------------------------------------


def process_retrieve_response(
    response,
    body,
    pricing_info,
    server_address,
    server_port,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content,
    disable_metrics,
    version,
    event_provider=None,
):
    """Non-streaming retrieval response processor."""
    end_time = time.time()
    response_dict = response_as_dict(response)

    kb_id = body.get("knowledge_base_uuid") or body.get("knowledge_base_id") or ""

    scope = _new_scope(
        body, span, start_time, server_address, server_port, response_dict
    )
    scope._end_time = end_time

    common_span_attributes(
        scope,
        SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
        SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
        server_address,
        server_port,
        None,
        None,
        environment,
        application_name,
        False,
        0,
        0,
        version,
    )
    if kb_id:
        span.set_attribute(SemanticConvention.GEN_AI_DATA_SOURCE_ID, kb_id)
    if body.get("top_k") is not None:
        span.set_attribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, body["top_k"])

    if capture_message_content:
        query = body.get("query")
        if query is not None:
            span.set_attribute(
                SemanticConvention.GEN_AI_RETRIEVAL_QUERY_TEXT, str(query)
            )
        retrieved = response_dict.get("retrieved_data") or response_dict.get(
            "documents"
        )
        if retrieved is not None:
            try:
                span.set_attribute(
                    SemanticConvention.GEN_AI_RETRIEVAL_DOCUMENTS,
                    json.dumps(retrieved)[:65536],
                )
            except Exception:
                pass

    span.set_status(Status(StatusCode.OK))

    if not disable_metrics and metrics:
        record_completion_metrics(
            metrics,
            SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
            SemanticConvention.GEN_AI_SYSTEM_DIGITALOCEAN,
            server_address,
            server_port,
            kb_id or "unknown",
            kb_id or "unknown",
            environment,
            application_name,
            start_time,
            end_time,
            0,
            0,
            0,
            None,
            None,
        )
    return response
