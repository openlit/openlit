"""
Claude Agent SDK utilities for OTel GenAI semantic convention compliant telemetry.

Follows the same patterns as the CrewAI / LangGraph / OpenAI Agents instrumentations.
All operation names, span kinds, and attributes comply with the OTel GenAI
semantic conventions (gen-ai-spans.md, gen-ai-agent-spans.md, gen-ai-events.md).
"""

import json
import logging
import time

from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import (
    common_framework_span_attributes,
    get_chat_model_cost,
    get_server_address_for_provider,
    handle_exception,
    otel_event,
    truncate_content,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# OTel GenAI Operation Mapping
# ---------------------------------------------------------------------------
OPERATION_MAP = {
    "query": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "receive_response": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "execute_tool": SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
    "subagent": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "chat": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    "create_agent": SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
}

# ---------------------------------------------------------------------------
# SpanKind per operation type (OTel GenAI spec)
# ---------------------------------------------------------------------------
SPAN_KIND_MAP = {
    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT: SpanKind.CLIENT,
    SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT: SpanKind.CLIENT,
}

SERVER_ADDRESS, SERVER_PORT = get_server_address_for_provider("anthropic")
GEN_AI_SYSTEM_ATTR = "gen_ai.system"
GEN_AI_SYSTEM_VALUE = "anthropic"

ANTHROPIC_FINISH_REASON_MAP = {
    "end_turn": "stop",
    "max_tokens": "length",
    "stop_sequence": "stop",
    "tool_use": "tool_call",
}


def _map_finish_reason(raw_reason):
    """Map an Anthropic stop_reason to the OTel standard value."""
    if not raw_reason:
        return "stop"
    return ANTHROPIC_FINISH_REASON_MAP.get(str(raw_reason), str(raw_reason))


def get_span_kind(operation_type):
    """Return the correct SpanKind for *operation_type* per OTel GenAI spec."""
    return SPAN_KIND_MAP.get(operation_type, SpanKind.INTERNAL)


# Endpoints where the second span-name segment should reflect a tool, model, or agent id.
_SPAN_NAME_ENTITY_ENDPOINTS = frozenset(
    (
        "execute_tool",
        "subagent",
        "chat",
        "create_agent",
        "query",
        "receive_response",
    )
)


def resolve_agent_display_name(options):
    """Return a short label for the root agent span (e.g. configured model), or None."""
    if options is None:
        return None
    model = getattr(options, "model", None)
    if model is not None and str(model).strip():
        return str(model)
    return None


def generate_span_name(endpoint, entity_name=None):
    """Return an OTel-compliant span name: ``{operation} {entity}``."""
    operation = OPERATION_MAP.get(
        endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
    )
    fallback = SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK

    if endpoint in _SPAN_NAME_ENTITY_ENDPOINTS and entity_name:
        return f"{operation} {entity_name}"

    return f"{operation} {fallback}"


# ---------------------------------------------------------------------------
# Message attribute extraction
# ---------------------------------------------------------------------------
def extract_usage(usage):
    """Extract token counts from a usage dict or object.

    Returns a dict with keys mapping to SemanticConvention constants.
    """
    attrs = {}
    if usage is None:
        return attrs

    if isinstance(usage, dict):
        get = usage.get
    else:

        def get(key, default=None):
            return getattr(usage, key, default)

    raw_input = get("input_tokens")
    try:
        raw_input = int(raw_input) if raw_input is not None else 0
    except (TypeError, ValueError):
        raw_input = 0

    output_tokens = get("output_tokens")
    if output_tokens is not None:
        try:
            attrs[SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS] = int(output_tokens)
        except (TypeError, ValueError):
            pass

    cache_read = get("cache_read_input_tokens")
    cache_read_int = 0
    if cache_read is not None:
        try:
            cache_read_int = int(cache_read)
            attrs[SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] = (
                cache_read_int
            )
        except (TypeError, ValueError):
            pass

    cache_creation = get("cache_creation_input_tokens")
    if cache_creation is None:
        cache_creation = get("cache_write_input_tokens")
    cache_creation_int = 0
    if cache_creation is not None:
        try:
            cache_creation_int = int(cache_creation)
            attrs[SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] = (
                cache_creation_int
            )
        except (TypeError, ValueError):
            pass

    total_input = raw_input + cache_read_int + cache_creation_int
    attrs[SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS] = total_input

    return attrs


def update_root_from_assistant(span, message):
    """Update the root invoke_agent span with metadata from an AssistantMessage.

    Only sets model and session_id on the root span. Per-call usage and
    content go on chat child spans instead.
    """
    try:
        model = getattr(message, "model", None)
        if model:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, str(model))
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, str(model))

        session_id = getattr(message, "session_id", None)
        if session_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID, str(session_id)
            )

    except Exception:
        pass


def has_llm_call_data(message):
    """Return True if this AssistantMessage represents an actual LLM API call."""
    return (
        getattr(message, "model", None) is not None
        and getattr(message, "usage", None) is not None
    )


def has_meaningful_content(content):
    """Return True if *content* has at least one non-empty TextBlock or ToolUseBlock.

    ThinkingBlocks and empty TextBlocks are NOT considered meaningful — the
    SDK often yields an initial AssistantMessage with only those before
    delivering the real content in a follow-up yield with the same
    ``message_id``.
    """
    if not content:
        return False
    for block in content:
        name = type(block).__name__
        if name == "ToolUseBlock":
            return True
        if name == "TextBlock" and getattr(block, "text", ""):
            return True
    return False


def build_input_from_tool_results(message):
    """Build an OTel-compliant input_messages list from a UserMessage with tool results.

    Returns a list like::

        [{"role": "user", "parts": [{"type": "tool_call_response", "id": "...", "response": "..."}]}]

    Returns ``None`` if there are no tool result blocks.
    """
    content = getattr(message, "content", None)
    if not content or not isinstance(content, list):
        return None
    parts = []
    for block in content:
        if type(block).__name__ == "ToolResultBlock":
            tool_use_id = getattr(block, "tool_use_id", None)
            result_content = getattr(block, "content", None)
            parts.append(
                {
                    "type": "tool_call_response",
                    "id": str(tool_use_id) if tool_use_id else "",
                    "response": truncate_content(str(result_content))
                    if result_content
                    else "",
                }
            )
    if not parts:
        return None
    return [{"role": "user", "parts": parts}]


def set_chat_span_attributes(
    span,
    message,
    capture_message_content,
    environment,
    application_name,
    version,
    pricing_info=None,
    event_provider=None,
    input_messages=None,
):
    """Set OTel-compliant attributes on a chat child span.

    Chat spans represent the underlying Anthropic LLM API call, so
    ``gen_ai.provider.name`` is set to the OTel well-known value
    ``"anthropic"`` (not ``"claude_agent_sdk"``).
    """
    try:
        model = getattr(message, "model", None)
        model_str = str(model) if model else None

        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_PROVIDER_NAME,
            SemanticConvention.GEN_AI_SYSTEM_ANTHROPIC,
        )
        span.set_attribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE)
        span.set_attribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS)
        span.set_attribute(SemanticConvention.SERVER_PORT, SERVER_PORT)
        span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
        span.set_attribute(SemanticConvention.GEN_AI_APPLICATION_NAME, application_name)
        span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

        if model_str:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_str)
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, model_str)

        usage = getattr(message, "usage", None)
        usage_attrs = extract_usage(usage) if usage else {}
        for key, value in usage_attrs.items():
            span.set_attribute(key, value)

        stop_reason = getattr(message, "stop_reason", None)
        if not stop_reason:
            content_blocks = getattr(message, "content", None)
            if content_blocks:
                for block in content_blocks:
                    if type(block).__name__ == "ToolUseBlock":
                        stop_reason = "tool_use"
                        break
        mapped_reason = _map_finish_reason(stop_reason)
        span.set_attribute(
            SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [mapped_reason]
        )

        message_id = getattr(message, "message_id", None)
        if message_id:
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, str(message_id))

        session_id = getattr(message, "session_id", None)
        if session_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID, str(session_id)
            )

        input_tokens = usage_attrs.get(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 0)
        output_tokens = usage_attrs.get(
            SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 0
        )
        cost = _calculate_cost(model_str, pricing_info, input_tokens, output_tokens)
        span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, cost)

        output_messages = None
        if capture_message_content:
            if input_messages:
                span.set_attribute(
                    SemanticConvention.GEN_AI_INPUT_MESSAGES,
                    json.dumps(input_messages),
                )

            output_messages = _build_output_messages(message, mapped_reason)
            if output_messages:
                span.set_attribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    json.dumps(output_messages),
                )

        span.set_status(Status(StatusCode.OK))

        if event_provider and capture_message_content:
            _emit_chat_inference_event(
                event_provider,
                model_str,
                message_id,
                session_id,
                mapped_reason,
                usage_attrs,
                input_messages,
                output_messages,
            )

    except Exception:
        pass


def _build_output_messages(message, mapped_finish_reason):
    """Build OTel-compliant output messages from assistant content blocks.

    Returns a list following the gen-ai-output-messages JSON schema::

        [{"role": "assistant",
          "parts": [{"type": "text", "content": "..."},
                     {"type": "tool_call", "id": "...", "name": "...", "arguments": {...}}],
          "finish_reason": "stop"}]

    Returns ``None`` if there is no content.
    """
    try:
        content = getattr(message, "content", None)
        if not content:
            return None

        parts = []
        for block in content:
            block_type = type(block).__name__
            if block_type == "TextBlock":
                text = getattr(block, "text", None)
                if text:
                    parts.append(
                        {
                            "type": "text",
                            "content": truncate_content(str(text)),
                        }
                    )
            elif block_type == "ThinkingBlock":
                thinking = getattr(block, "thinking", None)
                if thinking:
                    parts.append(
                        {
                            "type": "reasoning",
                            "content": truncate_content(str(thinking)),
                        }
                    )
            elif block_type == "ToolUseBlock":
                tool_name = getattr(block, "name", "unknown")
                tool_input = getattr(block, "input", {})
                tool_id = getattr(block, "id", "")
                if not isinstance(tool_input, dict):
                    try:
                        tool_input = json.loads(str(tool_input))
                    except (TypeError, ValueError, json.JSONDecodeError):
                        tool_input = {}
                parts.append(
                    {
                        "type": "tool_call",
                        "id": str(tool_id),
                        "name": str(tool_name),
                        "arguments": tool_input,
                    }
                )

        if not parts:
            return None

        return [
            {
                "role": "assistant",
                "parts": parts,
                "finish_reason": mapped_finish_reason,
            }
        ]
    except Exception:
        return None


def _calculate_cost(model_str, pricing_info, input_tokens, output_tokens):
    """Estimate cost using the shared OpenLIT pricing helper."""
    if not pricing_info or not model_str:
        return 0
    return get_chat_model_cost(model_str, pricing_info, input_tokens, output_tokens)


def _emit_chat_inference_event(
    event_provider,
    model_str,
    message_id,
    session_id,
    mapped_reason,
    usage_attrs,
    input_messages,
    output_messages,
):
    """Emit ``gen_ai.client.inference.operation.details`` log event for a chat span."""
    try:
        if not event_provider:
            return

        attributes = {
            SemanticConvention.GEN_AI_OPERATION: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            SemanticConvention.SERVER_ADDRESS: SERVER_ADDRESS,
            SemanticConvention.SERVER_PORT: SERVER_PORT,
        }

        if model_str:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = model_str
            attributes[SemanticConvention.GEN_AI_RESPONSE_MODEL] = model_str
        if message_id:
            attributes[SemanticConvention.GEN_AI_RESPONSE_ID] = str(message_id)
        if session_id:
            attributes[SemanticConvention.GEN_AI_CONVERSATION_ID] = str(session_id)
        if mapped_reason:
            attributes[SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON] = [
                mapped_reason
            ]

        for key, value in usage_attrs.items():
            attributes[key] = value

        if input_messages is not None:
            attributes[SemanticConvention.GEN_AI_INPUT_MESSAGES] = input_messages
        if output_messages is not None:
            attributes[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = output_messages

        event = otel_event(
            name=SemanticConvention.GEN_AI_CLIENT_INFERENCE_OPERATION_DETAILS,
            attributes=attributes,
            body="",
        )
        event_provider.emit(event)

    except Exception as exc:
        logger.debug("Failed to emit chat inference event: %s", exc)


def process_result_message(span, message, capture_message_content):
    """Set span attributes from a ResultMessage (final result).

    Returns a dict with ``input_tokens`` and ``output_tokens`` for metrics.
    """
    result_usage = {"input_tokens": 0, "output_tokens": 0}
    try:
        session_id = getattr(message, "session_id", None)
        if session_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID, str(session_id)
            )

        usage = getattr(message, "usage", None)
        if usage:
            usage_attrs = extract_usage(usage)
            for key, value in usage_attrs.items():
                span.set_attribute(key, value)
            result_usage["input_tokens"] = usage_attrs.get(
                SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 0
            )
            result_usage["output_tokens"] = usage_attrs.get(
                SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 0
            )

        cost = getattr(message, "total_cost_usd", None)
        if cost is not None:
            try:
                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST, float(cost))
            except (TypeError, ValueError):
                pass

        model_usage = getattr(message, "model_usage", None)
        if model_usage and isinstance(model_usage, dict):
            for model_name in model_usage:
                span.set_attribute(
                    SemanticConvention.GEN_AI_RESPONSE_MODEL, str(model_name)
                )
                break

        num_turns = getattr(message, "num_turns", None)
        if num_turns is not None:
            try:
                span.set_attribute("gen_ai.agent.num_turns", int(num_turns))
            except (TypeError, ValueError):
                pass

        duration_ms = getattr(message, "duration_ms", None)
        if duration_ms is not None:
            try:
                span.set_attribute("gen_ai.agent.duration_ms", int(duration_ms))
            except (TypeError, ValueError):
                pass

        duration_api_ms = getattr(message, "duration_api_ms", None)
        if duration_api_ms is not None:
            try:
                span.set_attribute("gen_ai.agent.duration_api_ms", int(duration_api_ms))
            except (TypeError, ValueError):
                pass

        is_error = getattr(message, "is_error", False)
        if is_error:
            error_result = getattr(message, "result", None)
            error_msg = str(error_result) if error_result else "unknown error"
            span.set_attribute(SemanticConvention.ERROR_TYPE, error_msg)
            span.set_status(Status(StatusCode.ERROR, error_msg))
        else:
            span.set_status(Status(StatusCode.OK))

        if capture_message_content:
            result = getattr(message, "result", None)
            if result:
                span.set_attribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    json.dumps(
                        [
                            {
                                "role": "assistant",
                                "parts": [
                                    {
                                        "type": "text",
                                        "content": truncate_content(str(result)),
                                    }
                                ],
                            }
                        ]
                    ),
                )
    except Exception:
        pass

    return result_usage


def set_create_agent_attributes(
    span, version, environment, application_name, agent_name=None
):
    """Set OTel-compliant attributes on a create_agent span."""
    try:
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_PROVIDER_NAME,
            SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
        )
        span.set_attribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE)
        span.set_attribute(
            SemanticConvention.GEN_AI_AGENT_NAME,
            agent_name or SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
        )
        span.set_attribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS)
        span.set_attribute(SemanticConvention.SERVER_PORT, SERVER_PORT)
        span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
        span.set_attribute(SemanticConvention.GEN_AI_APPLICATION_NAME, application_name)
        span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)
    except Exception:
        pass


def set_initial_span_attributes(
    span,
    start_time,
    version,
    environment,
    application_name,
    options=None,
    prompt=None,
    capture_message_content=False,
):
    """Set the initial common attributes on an agent span at creation time."""
    try:
        scope = type("Scope", (), {})()
        scope._span = span
        scope._start_time = start_time
        scope._end_time = start_time

        model = None
        if options is not None:
            model = getattr(options, "model", None)

        model_proxy = type("P", (), {"model_name": str(model)})() if model else None

        common_framework_span_attributes(
            scope,
            SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
            SERVER_ADDRESS,
            SERVER_PORT,
            environment,
            application_name,
            version,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
            model_proxy,
        )

        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_PROVIDER_NAME,
            SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
        )
        span.set_attribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE)
        agent_label = resolve_agent_display_name(options)
        span.set_attribute(
            SemanticConvention.GEN_AI_AGENT_NAME,
            agent_label or SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
        )

        if model:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, str(model))

        if capture_message_content:
            if options is not None:
                system_prompt = getattr(options, "system_prompt", None)
                if system_prompt and isinstance(system_prompt, str):
                    span.set_attribute(
                        SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                        json.dumps(
                            [
                                {
                                    "type": "text",
                                    "content": truncate_content(str(system_prompt)),
                                }
                            ]
                        ),
                    )

            if prompt and isinstance(prompt, str):
                span.set_attribute(
                    SemanticConvention.GEN_AI_INPUT_MESSAGES,
                    json.dumps(
                        [
                            {
                                "role": "user",
                                "parts": [
                                    {
                                        "type": "text",
                                        "content": truncate_content(str(prompt)),
                                    }
                                ],
                            }
                        ]
                    ),
                )

    except Exception as e:
        handle_exception(span, e)


def finalize_span(
    span,
    start_time,
    metrics,
    disable_metrics,
    environment,
    application_name,
    input_tokens=0,
    output_tokens=0,
):
    """Record duration and token usage metrics and finalize an agent span."""
    try:
        end_time = time.time()
        duration = end_time - start_time

        span.set_attribute(
            SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration
        )

        if not disable_metrics and metrics:
            _record_metrics(
                metrics,
                SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
                duration,
                environment,
                application_name,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
    except Exception:
        pass


def set_tool_span_attributes(
    span,
    tool_name,
    tool_input,
    tool_use_id,
    capture_message_content,
    environment,
    application_name,
    version,
):
    """Set OTel-compliant attributes on an execute_tool span."""
    try:
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_PROVIDER_NAME,
            SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK,
        )
        span.set_attribute(GEN_AI_SYSTEM_ATTR, GEN_AI_SYSTEM_VALUE)
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, str(tool_name))
        tool_type = "extension" if str(tool_name).startswith("mcp__") else "function"
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, tool_type)

        if tool_use_id:
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, str(tool_use_id))

        span.set_attribute(SemanticConvention.SERVER_ADDRESS, SERVER_ADDRESS)
        span.set_attribute(SemanticConvention.SERVER_PORT, SERVER_PORT)
        span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
        span.set_attribute(SemanticConvention.GEN_AI_APPLICATION_NAME, application_name)
        span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)

        if capture_message_content and tool_input is not None:
            try:
                args_str = json.dumps(tool_input)
            except (TypeError, ValueError):
                args_str = str(tool_input)
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                truncate_content(args_str),
            )
    except Exception:
        pass


def finalize_tool_span(
    span, tool_response, capture_message_content, is_error=False, error_message=None
):
    """Finalize an execute_tool span with result or error."""
    try:
        if is_error:
            err_msg = str(error_message) if error_message else "tool execution failed"
            span.set_attribute(SemanticConvention.ERROR_TYPE, err_msg)
            span.set_status(Status(StatusCode.ERROR, err_msg))
        else:
            if capture_message_content and tool_response is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                    truncate_content(str(tool_response)),
                )
            span.set_status(Status(StatusCode.OK))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def _record_metrics(
    metrics,
    operation_type,
    duration,
    environment,
    application_name,
    input_tokens=0,
    output_tokens=0,
):
    """Record OTel-compliant metrics with correct attribute keys."""
    try:
        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_type,
            SemanticConvention.GEN_AI_PROVIDER_NAME: (
                SemanticConvention.GEN_AI_SYSTEM_CLAUDE_AGENT_SDK
            ),
            GEN_AI_SYSTEM_ATTR: GEN_AI_SYSTEM_VALUE,
            "service.name": application_name,
            "deployment.environment": environment,
            SemanticConvention.SERVER_ADDRESS: SERVER_ADDRESS,
            SemanticConvention.SERVER_PORT: SERVER_PORT,
        }

        if "genai_client_operation_duration" in metrics:
            metrics["genai_client_operation_duration"].record(duration, attributes)

        if "genai_client_usage_tokens" in metrics:
            if input_tokens:
                input_attrs = {
                    **attributes,
                    SemanticConvention.GEN_AI_TOKEN_TYPE: SemanticConvention.GEN_AI_TOKEN_TYPE_INPUT,
                }
                metrics["genai_client_usage_tokens"].record(input_tokens, input_attrs)
            if output_tokens:
                output_attrs = {
                    **attributes,
                    SemanticConvention.GEN_AI_TOKEN_TYPE: SemanticConvention.GEN_AI_TOKEN_TYPE_OUTPUT,
                }
                metrics["genai_client_usage_tokens"].record(output_tokens, output_attrs)
    except Exception:
        pass
