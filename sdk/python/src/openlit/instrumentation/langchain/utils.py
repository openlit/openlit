"""
LangChain OpenTelemetry instrumentation utility functions.
"""

import json
import logging
import time
from typing import Any, List

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    common_span_attributes,
    get_chat_model_cost,
    record_completion_metrics,
    calculate_ttft,
    calculate_tbt,
    general_tokens,
    otel_event,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)


def format_content(messages_or_prompts: Any) -> str:
    """
    Format messages or prompts for display and token fallback.
    Handles LangChain message lists (list-of-lists of BaseMessage) and prompt lists.
    """
    if not messages_or_prompts:
        return ""
    if isinstance(messages_or_prompts, str):
        return messages_or_prompts
    parts = []
    for item in messages_or_prompts:
        if isinstance(item, str):
            parts.append(item)
            continue
        if isinstance(item, list):
            for msg in item:
                role = getattr(msg, "type", getattr(msg, "role", "user"))
                content = getattr(msg, "content", str(msg))
                parts.append(f"{role}: {content}")
        else:
            parts.append(str(item))
    return "\n".join(parts) if parts else ""


def build_input_messages_from_langchain(messages: List) -> List[dict]:
    """
    Convert LangChain messages (list-of-lists of BaseMessage) to OTel input message structure.
    """
    try:
        structured = []
        for msg_list in messages:
            for msg in msg_list:
                role = getattr(msg, "type", "user")
                content = getattr(msg, "content", str(msg))
                role_mapping = {
                    "system": "system",
                    "human": "user",
                    "ai": "assistant",
                    "tool": "tool",
                    "function": "tool",
                }
                otel_role = role_mapping.get(role, "user")
                structured.append(
                    {
                        "role": otel_role,
                        "parts": [{"type": "text", "content": str(content)}],
                    }
                )
        return structured
    except Exception as e:
        logger.debug("Error building input messages from LangChain: %s", e)
        return []


def build_input_messages_from_prompts(prompts: List) -> List[dict]:
    """
    Convert LangChain prompts (strings) to OTel input message structure.
    """
    try:
        structured = []
        for prompt_list in prompts:
            prompt_text = (
                prompt_list if isinstance(prompt_list, str) else str(prompt_list)
            )
            structured.append(
                {
                    "role": "user",
                    "parts": [{"type": "text", "content": prompt_text}],
                }
            )
        return structured
    except Exception as e:
        logger.debug("Error building input messages from prompts: %s", e)
        return []


def build_input_messages(messages_or_prompts: Any) -> List[dict]:
    """
    Convert LangChain request messages or prompts to OTel input message structure.
    Follows gen-ai-input-messages schema.
    Dispatches to from_langchain (list-of-lists of messages) or from_prompts (list of strings).
    """
    if not messages_or_prompts:
        return []
    # Prompts: list of strings or list of lists with string at 0
    if isinstance(messages_or_prompts, list) and messages_or_prompts:
        first = messages_or_prompts[0]
        if isinstance(first, str):
            return build_input_messages_from_prompts(messages_or_prompts)
        if isinstance(first, list) and first and hasattr(first[0], "content"):
            return build_input_messages_from_langchain(messages_or_prompts)
        return build_input_messages_from_prompts(messages_or_prompts)
    return []


def build_output_messages(
    response_text: str,
    finish_reason: str = "stop",
    tool_calls: Any = None,
) -> List[dict]:
    """
    Convert LangChain response to OTel output message structure.
    Follows gen-ai-output-messages schema.
    """
    try:
        if not response_text and not tool_calls:
            return []
        parts = []
        if response_text:
            parts.append({"type": "text", "content": str(response_text)})
        if tool_calls:
            for tc in tool_calls if isinstance(tool_calls, list) else [tool_calls]:
                if isinstance(tc, dict):
                    func = tc.get("function", tc.get("function_call", {}))
                    if isinstance(func, dict):
                        parts.append(
                            {
                                "type": "tool_call",
                                "id": tc.get("id", ""),
                                "name": func.get("name", ""),
                                "arguments": func.get(
                                    "arguments", func.get("args", {})
                                ),
                            }
                        )
        if not parts:
            return []
        return [
            {
                "role": "assistant",
                "parts": parts,
                "finish_reason": finish_reason,
            }
        ]
    except Exception as e:
        logger.debug("Error building output messages: %s", e)
        return []


def _set_span_messages_as_array(
    span: Any,
    input_messages: Any,
    output_messages: Any,
) -> None:
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
    event_provider: Any,
    operation_name: str,
    request_model: str,
    response_model: str,
    input_messages: Any = None,
    output_messages: Any = None,
    tool_definitions: Any = None,
    server_address: str = None,
    server_port: Any = None,
    **extra_attrs: Any,
) -> None:
    """
    Emit gen_ai.client.inference.operation.details event.
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
        if server_port is not None:
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
                elif key == "reasoning_tokens":
                    attributes[SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS] = value
                elif key == "system_instructions":
                    attributes[SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS] = value
                elif key == "error_type":
                    attributes[SemanticConvention.ERROR_TYPE] = value
                elif key == "conversation_id":
                    attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = value

        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )
        event_provider.emit(event)

    except Exception as e:
        logger.warning("Failed to emit inference event: %s", e, exc_info=True)


def _get_scope_params(scope: Any) -> dict:
    """Get request params from scope (_kwargs or _model_parameters)."""
    return (
        getattr(scope, "_kwargs", None)
        or getattr(scope, "_model_parameters", None)
        or {}
    )


def common_chat_logic(
    scope: Any,
    pricing_info: Any,
    environment: str,
    application_name: str,
    metrics: Any,
    capture_message_content: bool,
    disable_metrics: bool,
    version: str,
    is_stream: bool,
    event_provider: Any = None,
) -> None:
    """
    Process chat request and generate Telemetry.
    """
    scope._end_time = time.time()
    if len(scope._timestamps) > 1:
        scope._tbt = calculate_tbt(scope._timestamps)

    prompt = format_content(
        getattr(scope, "_input_messages_raw", None)
        or getattr(scope, "_prompts", None)
        or []
    )
    request_model = getattr(scope, "_request_model", None) or "unknown"

    if (
        hasattr(scope, "_input_tokens")
        and scope._input_tokens is not None
        and hasattr(scope, "_output_tokens")
        and scope._output_tokens is not None
    ):
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
        SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
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
    params = _get_scope_params(scope)
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        params.get("temperature", 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        params.get("max_tokens", params.get("max_completion_tokens", -1)),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_TOP_P,
        params.get("top_p", 1.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        params.get("frequency_penalty", 0.0),
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        params.get("presence_penalty", 0.0),
    )
    stop = params.get("stop", params.get("stop_sequences", []))
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        stop if isinstance(stop, list) else [stop] if stop else [],
    )
    seed_val = params.get("seed")
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_REQUEST_SEED,
        int(seed_val) if seed_val is not None else 0,
    )

    # Span Attributes for Response parameters
    if getattr(scope, "_response_id", None):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_ID, scope._response_id
        )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [getattr(scope, "_finish_reason", "stop")],
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        "text" if isinstance(scope._llmresponse, str) else "json",
    )

    # Span Attributes for Tools
    if getattr(scope, "_tools", None):
        tools = scope._tools if isinstance(scope._tools, list) else [scope._tools]
        names, ids, args = (
            zip(
                *[
                    (
                        t.get("function", {}).get("name", t.get("name", "")),
                        str(t.get("id", "")),
                        str(
                            t.get("function", {}).get(
                                "arguments", t.get("arguments", "")
                            )
                        ),
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
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
    )
    scope._span.set_attribute(
        SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
        input_tokens + output_tokens,
    )
    scope._span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

    # Reasoning tokens (optional)
    if (
        hasattr(scope, "_reasoning_tokens")
        and scope._reasoning_tokens
        and scope._reasoning_tokens > 0
    ):
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_USAGE_REASONING_TOKENS, scope._reasoning_tokens
        )
        scope._span.set_attribute(
            SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
            input_tokens + output_tokens + scope._reasoning_tokens,
        )

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
        input_raw = (
            getattr(scope, "_input_messages_raw", None)
            or getattr(scope, "_prompts", None)
            or []
        )
        input_msgs = build_input_messages(input_raw)
        output_msgs = build_output_messages(
            scope._llmresponse,
            getattr(scope, "_finish_reason", "stop"),
            tool_calls=getattr(scope, "_tools", None),
        )
        _set_span_messages_as_array(scope._span, input_msgs, output_msgs)

        if event_provider:
            try:
                extra = {
                    "cache_read_input_tokens": getattr(
                        scope, "_cache_read_input_tokens", 0
                    ),
                    "cache_creation_input_tokens": getattr(
                        scope, "_cache_creation_input_tokens", 0
                    ),
                    "response_id": getattr(scope, "_response_id", None),
                    "finish_reasons": [getattr(scope, "_finish_reason", "stop")],
                    "output_type": "text"
                    if isinstance(scope._llmresponse, str)
                    else "json",
                    "temperature": params.get("temperature"),
                    "max_tokens": params.get(
                        "max_tokens", params.get("max_completion_tokens")
                    ),
                    "top_p": params.get("top_p"),
                    "frequency_penalty": params.get("frequency_penalty"),
                    "presence_penalty": params.get("presence_penalty"),
                    "stop_sequences": params.get("stop", params.get("stop_sequences")),
                    "seed": params.get("seed"),
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                }
                if (
                    hasattr(scope, "_system_instructions")
                    and scope._system_instructions
                ):
                    extra["system_instructions"] = scope._system_instructions
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

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics
    if not disable_metrics and metrics:
        try:
            record_completion_metrics(
                metrics,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
                SemanticConvention.GEN_AI_SYSTEM_LANGCHAIN,
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
        except Exception as e:
            logger.debug("Error recording completion metrics: %s", e)
