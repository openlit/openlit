"""
OpenAI Agents utilities for OTel GenAI semantic convention compliant telemetry.

Follows the same patterns as the CrewAI / LangGraph instrumentations.
All operation names, span kinds, and attributes comply with the OTel GenAI
semantic conventions (gen-ai-spans.md, gen-ai-agent-spans.md).

The OpenAI Agents SDK reports span data via TracingProcessor callbacks.
Span data fields are populated *during* execution and are only fully
available at ``on_span_end`` -- all attribute setting therefore happens
in ``process_span_end``.
"""

import json
import time
from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import (
    common_framework_span_attributes,
    format_input_message,
    format_output_message,
    get_server_address_for_provider,
    handle_exception,
    truncate_content,
)
from openlit.semcov import SemanticConvention

_OPENAI_SERVER_ADDRESS, _OPENAI_SERVER_PORT = get_server_address_for_provider("openai")

# ---------------------------------------------------------------------------
# OTel GenAI operation mapping   (SDK span_data.type  ->  gen_ai.operation.name)
# ---------------------------------------------------------------------------
OPERATION_MAP = {
    "agent": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "generation": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    "response": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    "function": SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
    "handoff": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "guardrail": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "custom": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "transcription": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    "speech": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    "speech_group": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "mcp_tools": SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
}

# ---------------------------------------------------------------------------
# SpanKind per operation (OTel GenAI spec)
# ---------------------------------------------------------------------------
SPAN_KIND_MAP = {
    SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT: SpanKind.CLIENT,
}

_MAX_HANDOFFS = 1000


def get_operation_type(span_type):
    """Return the standard ``gen_ai.operation.name`` for an SDK span type."""
    return OPERATION_MAP.get(span_type, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)


def get_span_kind(operation_type):
    """Return the correct ``SpanKind`` per OTel GenAI spec."""
    return SPAN_KIND_MAP.get(operation_type, SpanKind.INTERNAL)


def generate_span_name(span_data):
    """Return an OTel-compliant span name: ``{operation} {entity}``."""
    span_type = getattr(span_data, "type", "unknown")
    operation = get_operation_type(span_type)

    if span_type == "agent":
        name = getattr(span_data, "name", None) or "agent"
        return f"{operation} {name}"

    if span_type in ("generation", "response"):
        model = _extract_model_from_span_data(span_data)
        if model:
            return f"{operation} {model}"
        return operation

    if span_type == "function":
        name = getattr(span_data, "name", None) or "function"
        return f"{operation} {name}"

    if span_type == "handoff":
        to_agent = getattr(span_data, "to_agent", None) or "unknown"
        return f"{operation} {to_agent}"

    if span_type == "guardrail":
        name = getattr(span_data, "name", None) or "guardrail"
        return f"{operation} {name}"

    if span_type == "mcp_tools":
        server = getattr(span_data, "server", None) or "mcp"
        return f"{operation} {server}"

    if span_type == "transcription":
        return f"{operation} transcription"

    if span_type == "speech":
        return f"{operation} speech"

    if span_type == "speech_group":
        return f"{operation} speech_group"

    if span_type == "custom":
        name = getattr(span_data, "name", None) or "custom"
        return f"{operation} {name}"

    return operation


# ---------------------------------------------------------------------------
# Main dispatcher -- called from ``on_span_end``
# ---------------------------------------------------------------------------
def process_span_end(
    otel_span,
    sdk_span,
    start_time,
    version,
    environment,
    application_name,
    capture_message_content,
    metrics,
    disable_metrics,
    conversation_id,
    handoff_tracker,
):
    """Set all OTel-compliant attributes on *otel_span* using fully-populated SDK data."""
    try:
        end_time = time.time()
        span_data = sdk_span.span_data
        span_type = getattr(span_data, "type", "unknown")
        operation = get_operation_type(span_type)
        model_name = _extract_model_from_span_data(span_data)

        updated_name = generate_span_name(span_data)
        try:
            otel_span.update_name(updated_name)
        except Exception:
            pass

        scope = type("Scope", (), {})()
        scope._span = otel_span
        scope._start_time = start_time
        scope._end_time = end_time

        server_address = _OPENAI_SERVER_ADDRESS
        server_port = _OPENAI_SERVER_PORT

        model_proxy = (
            type("P", (), {"model_name": model_name})() if model_name else None
        )

        common_framework_span_attributes(
            scope,
            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            server_address,
            server_port,
            environment,
            application_name,
            version,
            span_type,
            model_proxy,
        )

        otel_span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation)
        otel_span.set_attribute(
            SemanticConvention.GEN_AI_PROVIDER_NAME,
            SemanticConvention.GEN_AI_SYSTEM_OPENAI,
        )

        if conversation_id:
            otel_span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID, conversation_id
            )

        if model_name:
            otel_span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)

        # Dispatch to type-specific handler
        if span_type == "agent":
            _set_agent_attributes(otel_span, span_data, capture_message_content)
        elif span_type == "response":
            _set_response_attributes(otel_span, span_data, capture_message_content)
        elif span_type == "generation":
            _set_generation_attributes(otel_span, span_data, capture_message_content)
        elif span_type == "function":
            _set_function_attributes(otel_span, span_data, capture_message_content)
        elif span_type == "handoff":
            _set_handoff_attributes(
                otel_span, span_data, handoff_tracker, getattr(sdk_span, "trace_id", "")
            )
        elif span_type == "guardrail":
            _set_guardrail_attributes(otel_span, span_data)
        elif span_type == "transcription":
            _set_transcription_attributes(otel_span, span_data, capture_message_content)
        elif span_type == "speech":
            _set_speech_attributes(otel_span, span_data, capture_message_content)
        elif span_type == "mcp_tools":
            _set_mcp_tools_attributes(otel_span, span_data)
        elif span_type == "custom":
            _set_custom_attributes(otel_span, span_data)

        # Error handling per OTel recording-errors spec
        error = getattr(sdk_span, "error", None)
        if error:
            error_msg = (
                error.get("message", "unknown")
                if isinstance(error, dict)
                else str(error)
            )
            otel_span.set_attribute(SemanticConvention.ERROR_TYPE, error_msg)
            otel_span.set_status(Status(StatusCode.ERROR, error_msg))
        else:
            otel_span.set_status(Status(StatusCode.OK))

        # Metrics
        if not disable_metrics and metrics:
            _record_metrics(
                metrics,
                operation,
                end_time - start_time,
                environment,
                application_name,
                model_name,
                server_address,
                server_port,
            )

    except Exception as e:
        handle_exception(otel_span, e)


_OUTPUT_TYPE_MAP = {
    str: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
    "str": SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
    dict: SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON,
    "dict": SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON,
}


def _map_output_type(output_type):
    """Map a Python type or string to an OTel standard gen_ai.output.type value."""
    if output_type is None:
        return SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
    mapped = _OUTPUT_TYPE_MAP.get(output_type)
    if mapped:
        return mapped
    type_str = str(output_type).lower()
    if "str" in type_str or "text" in type_str:
        return SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
    if "dict" in type_str or "json" in type_str:
        return SemanticConvention.GEN_AI_OUTPUT_TYPE_JSON
    return SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT


# ---------------------------------------------------------------------------
# Agent  (invoke_agent)
# ---------------------------------------------------------------------------
def _set_agent_attributes(span, span_data, capture_message_content):
    try:
        name = getattr(span_data, "name", None)
        if name:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))

        agent_obj = getattr(span_data, "agent", None)
        agent_id = getattr(span_data, "agent_id", None) or (
            str(id(agent_obj)) if agent_obj is not None else str(id(span_data))
        )
        span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, agent_id)

        output_type = getattr(span_data, "output_type", None)
        mapped_type = _map_output_type(output_type)
        span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, mapped_type)

        if capture_message_content:
            tools = getattr(span_data, "tools", None)
            if tools:
                tool_defs = [{"type": "function", "name": t} for t in tools[:20]]
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_DEFINITIONS,
                    json.dumps(tool_defs),
                )

            handoffs = getattr(span_data, "handoffs", None)
            if handoffs:
                span.set_attribute(
                    "gen_ai.agent.handoffs", json.dumps(list(handoffs[:20]))
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Response  (chat -- Response API, the primary LLM call type)
# ---------------------------------------------------------------------------
def _set_response_attributes(span, span_data, capture_message_content):
    try:
        response = getattr(span_data, "response", None)
        if not response:
            return

        model = getattr(response, "model", None)
        if model:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, str(model))
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, str(model))

        resp_id = getattr(response, "id", None)
        if resp_id:
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, str(resp_id))

        usage = getattr(response, "usage", None)
        if usage:
            input_tokens = getattr(usage, "input_tokens", None)
            output_tokens = getattr(usage, "output_tokens", None)
            if input_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
                )
            if output_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
                )

        # finish reasons from output items (OTel spec: string[] array)
        output_items = getattr(response, "output", None)
        if output_items:
            finish_reasons = []
            for item in output_items:
                status = getattr(item, "status", None)
                if status:
                    finish_reasons.append(str(status))
            if finish_reasons:
                span.set_attribute(
                    SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                    finish_reasons,
                )

        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_TYPE,
            SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
        )
        span.set_attribute(SemanticConvention.SERVER_ADDRESS, _OPENAI_SERVER_ADDRESS)
        span.set_attribute(SemanticConvention.SERVER_PORT, _OPENAI_SERVER_PORT)

        if capture_message_content:
            _capture_response_messages(span, span_data, response)

    except Exception:
        pass


def _capture_response_messages(span, span_data, response):
    """Capture input/output messages from ResponseSpanData."""
    try:
        raw_input = getattr(span_data, "input", None)
        if raw_input:
            if isinstance(raw_input, str):
                messages = [format_input_message("user", raw_input)]
            elif isinstance(raw_input, (list, tuple)):
                messages = []
                for item in raw_input[:20]:
                    if isinstance(item, dict):
                        messages.append(item)
                    else:
                        role = str(getattr(item, "role", "user"))
                        content = getattr(item, "content", str(item))
                        messages.append(format_input_message(role, content))
            else:
                messages = [format_input_message("user", raw_input)]
            span.set_attribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES, json.dumps(messages)
            )

        output_items = getattr(response, "output", None)
        if output_items:
            out_messages = []
            for item in output_items[:20]:
                item_type = getattr(item, "type", None)
                if item_type == "message":
                    content_parts = getattr(item, "content", [])
                    text_parts = []
                    for part in content_parts:
                        text = getattr(part, "text", None)
                        if text:
                            text_parts.append(truncate_content(str(text)))
                    if text_parts:
                        out_messages.append(format_output_message(" ".join(text_parts)))
                elif item_type == "function_call":
                    fname = getattr(item, "name", "unknown")
                    fargs = getattr(item, "arguments", "")
                    out_messages.append(
                        {
                            "role": "assistant",
                            "parts": [
                                {
                                    "type": "tool_call",
                                    "name": fname,
                                    "arguments": fargs,
                                }
                            ],
                        }
                    )
            if out_messages:
                span.set_attribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES, json.dumps(out_messages)
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Generation  (chat -- Chat Completions API, used for non-OpenAI models)
# ---------------------------------------------------------------------------
def _set_generation_attributes(span, span_data, capture_message_content):
    try:
        model = getattr(span_data, "model", None)
        if model:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, str(model))
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, str(model))

        usage = getattr(span_data, "usage", None)
        if usage and isinstance(usage, dict):
            input_tokens = usage.get("input_tokens")
            output_tokens = usage.get("output_tokens")
            if input_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
                )
            if output_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
                )

        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_TYPE,
            SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
        )
        span.set_attribute(SemanticConvention.SERVER_ADDRESS, _OPENAI_SERVER_ADDRESS)
        span.set_attribute(SemanticConvention.SERVER_PORT, _OPENAI_SERVER_PORT)

        if capture_message_content:
            raw_input = getattr(span_data, "input", None)
            if raw_input:
                if isinstance(raw_input, (list, tuple)):
                    messages = []
                    for msg in raw_input[:20]:
                        if isinstance(msg, dict):
                            messages.append(msg)
                        else:
                            messages.append(format_input_message("user", msg))
                    span.set_attribute(
                        SemanticConvention.GEN_AI_INPUT_MESSAGES, json.dumps(messages)
                    )
                else:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_INPUT_MESSAGES,
                        json.dumps([format_input_message("user", raw_input)]),
                    )

            raw_output = getattr(span_data, "output", None)
            if raw_output:
                if isinstance(raw_output, (list, tuple)):
                    messages = []
                    for msg in raw_output[:20]:
                        if isinstance(msg, dict):
                            messages.append(msg)
                        else:
                            messages.append(format_output_message(msg))
                    span.set_attribute(
                        SemanticConvention.GEN_AI_OUTPUT_MESSAGES, json.dumps(messages)
                    )
                else:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                        json.dumps([format_output_message(raw_output)]),
                    )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Function / Tool  (execute_tool)
# ---------------------------------------------------------------------------
def _set_function_attributes(span, span_data, capture_message_content):
    try:
        name = getattr(span_data, "name", None)
        if name:
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, str(name))

        span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, "function")

        if capture_message_content:
            tool_input = getattr(span_data, "input", None)
            if tool_input is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                    truncate_content(str(tool_input)),
                )

            tool_output = getattr(span_data, "output", None)
            if tool_output is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                    truncate_content(str(tool_output)),
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Handoff  (invoke_agent for target)
# ---------------------------------------------------------------------------
def _set_handoff_attributes(span, span_data, handoff_tracker, trace_id):
    try:
        to_agent = getattr(span_data, "to_agent", None)
        from_agent = getattr(span_data, "from_agent", None)

        if to_agent:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(to_agent))
            # Track for parent-child agent graph
            if handoff_tracker is not None:
                key = f"{to_agent}:{trace_id}"
                handoff_tracker[key] = str(from_agent) if from_agent else "unknown"
                if len(handoff_tracker) > _MAX_HANDOFFS:
                    handoff_tracker.popitem(last=False)

        if from_agent:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_SOURCE, str(from_agent))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Guardrail  (invoke_agent)
# ---------------------------------------------------------------------------
def _set_guardrail_attributes(span, span_data):
    try:
        name = getattr(span_data, "name", None)
        if name:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))

        triggered = getattr(span_data, "triggered", None)
        if triggered is not None:
            span.set_attribute("gen_ai.guardrail.triggered", bool(triggered))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Transcription  (chat)
# ---------------------------------------------------------------------------
def _set_transcription_attributes(span, span_data, capture_message_content):
    try:
        model = getattr(span_data, "model", None)
        if model:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, str(model))
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, str(model))

        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_TYPE,
            SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
        )
        span.set_attribute(SemanticConvention.SERVER_ADDRESS, _OPENAI_SERVER_ADDRESS)
        span.set_attribute(SemanticConvention.SERVER_PORT, _OPENAI_SERVER_PORT)

        if capture_message_content:
            output = getattr(span_data, "output", None)
            if output:
                span.set_attribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    json.dumps([format_output_message(output)]),
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Speech  (chat)
# ---------------------------------------------------------------------------
def _set_speech_attributes(span, span_data, capture_message_content):
    try:
        model = getattr(span_data, "model", None)
        if model:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, str(model))
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, str(model))

        span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, "speech")
        span.set_attribute(SemanticConvention.SERVER_ADDRESS, _OPENAI_SERVER_ADDRESS)
        span.set_attribute(SemanticConvention.SERVER_PORT, _OPENAI_SERVER_PORT)

        if capture_message_content:
            text_input = getattr(span_data, "input", None)
            if text_input:
                span.set_attribute(
                    SemanticConvention.GEN_AI_INPUT_MESSAGES,
                    json.dumps([format_input_message("user", text_input)]),
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# MCP List Tools  (execute_tool)
# ---------------------------------------------------------------------------
def _set_mcp_tools_attributes(span, span_data):
    try:
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, "mcp_list_tools")
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, "function")

        server = getattr(span_data, "server", None)
        if server:
            span.set_attribute("gen_ai.mcp.server", str(server))

        result = getattr(span_data, "result", None)
        if result:
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                json.dumps(list(result[:50])),
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Custom  (invoke_agent)
# ---------------------------------------------------------------------------
def _set_custom_attributes(span, span_data):
    try:
        name = getattr(span_data, "name", None)
        if name:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))

        data = getattr(span_data, "data", None)
        if data and isinstance(data, dict):
            try:
                span.set_attribute("gen_ai.custom.data", json.dumps(data))
            except (TypeError, ValueError):
                pass
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
    request_model,
    server_address,
    server_port,
):
    try:
        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_type,
            SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_OPENAI,
            "service.name": application_name,
            "deployment.environment": environment,
        }
        if request_model:
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if server_address:
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port:
            attributes[SemanticConvention.SERVER_PORT] = server_port

        if "genai_client_operation_duration" in metrics:
            metrics["genai_client_operation_duration"].record(duration, attributes)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _extract_model_from_span_data(span_data):
    """Best-effort model name extraction from any span_data type."""
    model = getattr(span_data, "model", None)
    if model:
        return str(model)

    response = getattr(span_data, "response", None)
    if response:
        model = getattr(response, "model", None)
        if model:
            return str(model)

    return None
