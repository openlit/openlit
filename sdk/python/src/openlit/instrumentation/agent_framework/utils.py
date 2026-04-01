"""
Microsoft Agent Framework utilities for OTel GenAI semantic convention
compliant telemetry.

Follows the same patterns as CrewAI / Google ADK / OpenAI Agents
instrumentations.  All operation names, span kinds, and attributes comply
with the OTel GenAI semantic conventions (gen-ai-spans.md,
gen-ai-agent-spans.md).
"""

import time
import json
from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import (
    common_framework_span_attributes,
    truncate_content,
)
from openlit.semcov import SemanticConvention

# ---------------------------------------------------------------------------
# OTel GenAI operation mapping
# ---------------------------------------------------------------------------
OPERATION_MAP = {
    "agent_init": SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
    "agent_run": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "tool_execute": SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
    "workflow_run": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
}

# ---------------------------------------------------------------------------
# SpanKind per operation (OTel GenAI spec)
# ---------------------------------------------------------------------------
SPAN_KIND_MAP = {
    SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT: SpanKind.CLIENT,
    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS: SpanKind.INTERNAL,
}


def get_operation_type(endpoint):
    """Return the standard ``gen_ai.operation.name`` for an AF endpoint."""
    return OPERATION_MAP.get(endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)


def get_span_kind(operation_type):
    """Return the correct ``SpanKind`` per OTel GenAI spec."""
    return SPAN_KIND_MAP.get(operation_type, SpanKind.INTERNAL)


# ---------------------------------------------------------------------------
# Span name generation
# ---------------------------------------------------------------------------
def generate_span_name(endpoint, instance, args=None, kwargs=None):
    """Return an OTel-compliant span name: ``{operation} {entity_name}``."""
    operation_type = get_operation_type(endpoint)

    if endpoint == "agent_init":
        name = (
            getattr(instance, "name", None) or getattr(instance, "id", None) or "agent"
        )
        return f"create_agent {name}"

    if endpoint == "agent_run":
        name = (
            getattr(instance, "name", None) or getattr(instance, "id", None) or "agent"
        )
        return f"invoke_agent {name}"

    if endpoint == "tool_execute":
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"execute_tool {name}"

    if endpoint == "workflow_run":
        name = (
            getattr(instance, "name", None)
            or getattr(instance, "id", None)
            or "workflow"
        )
        return f"invoke_workflow {name}"

    return f"{operation_type} {endpoint}"


# ---------------------------------------------------------------------------
# Model name extraction
# ---------------------------------------------------------------------------
def _extract_model_name(instance):
    """Best-effort model name extraction from an AF Agent instance."""
    if not instance:
        return "unknown"

    model_id = getattr(instance, "model_id", None)
    if model_id:
        return str(model_id)

    chat_client = getattr(instance, "chat_client", None)
    if chat_client:
        model_id = getattr(chat_client, "model_id", None)
        if model_id:
            return str(model_id)

    default_options = getattr(instance, "default_options", None)
    if default_options and isinstance(default_options, dict):
        model_id = default_options.get("model_id")
        if model_id:
            return str(model_id)

    return "unknown"


# ---------------------------------------------------------------------------
# Server address resolution
# ---------------------------------------------------------------------------
def _resolve_server_info(instance):
    """Return ``(server_address, server_port)`` from an AF agent's chat client."""
    server_address = ""
    server_port = 0
    try:
        chat_client = getattr(instance, "chat_client", None)
        if chat_client:
            service_url_fn = getattr(chat_client, "service_url", None)
            if callable(service_url_fn):
                url_str = str(service_url_fn())
                if url_str and url_str != "unknown":
                    from urllib.parse import urlparse

                    parsed = urlparse(url_str)
                    server_address = parsed.hostname or ""
                    server_port = parsed.port or 443
    except Exception:
        pass
    return server_address, server_port


# ---------------------------------------------------------------------------
# Main response processor
# ---------------------------------------------------------------------------
def process_agent_framework_response(
    span,
    endpoint,
    instance,
    start_time,
    version,
    environment,
    application_name,
    capture_message_content,
    metrics,
    disable_metrics,
    response=None,
):
    """Set OTel-compliant span attributes and record metrics for a completed span."""
    end_time = time.time()

    operation_type = get_operation_type(endpoint)
    server_address, server_port = _resolve_server_info(instance)
    request_model = _extract_model_name(instance)

    scope = type("Scope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    model_proxy = (
        type("P", (), {"model_name": request_model})() if request_model else None
    )

    common_framework_span_attributes(
        scope,
        SemanticConvention.GEN_AI_SYSTEM_AGENT_FRAMEWORK,
        server_address,
        server_port,
        environment,
        application_name,
        version,
        operation_type,
        model_proxy,
    )

    if endpoint == "agent_run":
        _set_agent_attributes(span, instance)
        _extract_response_attributes(span, response)
        if capture_message_content:
            _capture_output_messages(span, response)

    elif endpoint == "workflow_run":
        _set_workflow_attributes(span, instance)

    span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
    )

    if not disable_metrics and metrics:
        _record_metrics(
            metrics,
            operation_type,
            end_time - start_time,
            environment,
            application_name,
            request_model,
            server_address,
            server_port,
        )

    span.set_status(Status(StatusCode.OK))


# ---------------------------------------------------------------------------
# Attribute setters
# ---------------------------------------------------------------------------
def _set_agent_attributes(span, instance):
    """Set agent-related attributes per OTel GenAI semantic conventions."""
    try:
        agent_id = getattr(instance, "id", None)
        if agent_id:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, str(agent_id))

        agent_name = getattr(instance, "name", None)
        if agent_name:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name))
        elif agent_id:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_id))

        description = getattr(instance, "description", None)
        if description:
            span.set_attribute(
                SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(description)
            )
    except Exception:
        pass


def _set_workflow_attributes(span, instance):
    """Set workflow-related attributes per OTel GenAI semantic conventions."""
    try:
        name = getattr(instance, "name", None) or getattr(instance, "id", None)
        if name:
            span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, str(name))
    except Exception:
        pass


def _set_tool_attributes(
    span,
    function_tool,
    capture_message_content,
    tool_call_id=None,
    arguments=None,
    result=None,
):
    """Set tool-related attributes per OTel GenAI semantic conventions."""
    try:
        if function_tool:
            tool_name = (
                getattr(function_tool, "name", None) or type(function_tool).__name__
            )
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, str(tool_name))
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, "function")

            tool_desc = getattr(function_tool, "description", None)
            if tool_desc:
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
                    truncate_content(str(tool_desc)),
                )

        if tool_call_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_ID, str(tool_call_id)
            )

        if capture_message_content:
            if arguments is not None:
                try:
                    args_str = (
                        json.dumps(arguments)
                        if isinstance(arguments, dict)
                        else str(arguments)
                    )
                except (TypeError, ValueError):
                    args_str = str(arguments)
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                    truncate_content(args_str),
                )
            if result is not None:
                try:
                    result_str = (
                        json.dumps(result)
                        if isinstance(result, (dict, list))
                        else str(result)
                    )
                except (TypeError, ValueError):
                    result_str = str(result)
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                    truncate_content(result_str),
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Response attribute extraction
# ---------------------------------------------------------------------------
def _extract_response_attributes(span, response):
    """Extract token usage, model, and response ID from an AgentResponse."""
    if response is None:
        return
    try:
        response_id = getattr(response, "response_id", None)
        if response_id:
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID, str(response_id))

        model_id = getattr(response, "model_id", None)
        if model_id:
            span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, str(model_id))

        usage = getattr(response, "usage_details", None)
        if usage and isinstance(usage, dict):
            input_tokens = usage.get("input_token_count")
            if input_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, int(input_tokens)
                )
            output_tokens = usage.get("output_token_count")
            if output_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, int(output_tokens)
                )

        finish_reason = getattr(response, "finish_reason", None)
        if finish_reason:
            span.set_attribute(
                SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                [str(finish_reason)],
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Content capture
# ---------------------------------------------------------------------------
def _capture_input_messages(span, messages):
    """Set ``gen_ai.input.messages`` from user input messages."""
    try:
        if messages is None:
            return
        if isinstance(messages, str):
            otel_msgs = [{"role": "user", "content": truncate_content(messages)}]
            span.set_attribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES, json.dumps(otel_msgs)
            )
            return

        if isinstance(messages, list):
            otel_msgs = []
            for msg in messages[:20]:
                if isinstance(msg, str):
                    otel_msgs.append({"role": "user", "content": truncate_content(msg)})
                elif hasattr(msg, "role") and hasattr(msg, "contents"):
                    parts = []
                    for content in getattr(msg, "contents", []):
                        content_type = getattr(content, "type", "text")
                        if content_type == "text":
                            text = getattr(content, "text", "")
                            parts.append(
                                {"type": "text", "content": truncate_content(str(text))}
                            )
                        elif content_type == "function_call":
                            parts.append(
                                {
                                    "type": "tool_call",
                                    "id": getattr(content, "call_id", ""),
                                    "name": getattr(content, "name", ""),
                                    "arguments": str(getattr(content, "arguments", "")),
                                }
                            )
                        elif content_type == "function_result":
                            parts.append(
                                {
                                    "type": "tool_call_response",
                                    "id": getattr(content, "call_id", ""),
                                    "response": str(getattr(content, "result", "")),
                                }
                            )
                    otel_msgs.append(
                        {
                            "role": str(getattr(msg, "role", "user")),
                            "parts": parts,
                        }
                    )
                elif isinstance(msg, dict):
                    otel_msgs.append(
                        {
                            "role": msg.get("role", "user"),
                            "content": truncate_content(str(msg.get("content", ""))),
                        }
                    )
            if otel_msgs:
                span.set_attribute(
                    SemanticConvention.GEN_AI_INPUT_MESSAGES,
                    json.dumps(otel_msgs),
                )
    except Exception:
        pass


def _capture_output_messages(span, response):
    """Set ``gen_ai.output.messages`` from an AgentResponse."""
    if response is None:
        return
    try:
        messages = getattr(response, "messages", None)
        if not messages:
            return
        otel_msgs = []
        for msg in messages[:20]:
            parts = []
            for content in getattr(msg, "contents", []):
                content_type = getattr(content, "type", "text")
                if content_type == "text":
                    text = getattr(content, "text", "")
                    parts.append(
                        {"type": "text", "content": truncate_content(str(text))}
                    )
                elif content_type == "function_call":
                    parts.append(
                        {
                            "type": "tool_call",
                            "id": getattr(content, "call_id", ""),
                            "name": getattr(content, "name", ""),
                            "arguments": str(getattr(content, "arguments", "")),
                        }
                    )
                elif content_type == "function_result":
                    parts.append(
                        {
                            "type": "tool_call_response",
                            "id": getattr(content, "call_id", ""),
                            "response": str(getattr(content, "result", "")),
                        }
                    )
                else:
                    text = getattr(content, "text", None)
                    if text:
                        parts.append(
                            {"type": "text", "content": truncate_content(str(text))}
                        )
            role = str(getattr(msg, "role", "assistant"))
            otel_msgs.append({"role": role, "parts": parts})
        if otel_msgs:
            span.set_attribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES, json.dumps(otel_msgs)
            )
    except Exception:
        pass


def _capture_system_instructions(span, instance):
    """Set ``gen_ai.system_instructions`` from an agent's instructions."""
    try:
        instructions = getattr(instance, "instructions", None)
        if instructions:
            span.set_attribute(
                SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                json.dumps(
                    [
                        {
                            "type": "text",
                            "content": truncate_content(str(instructions)),
                        }
                    ]
                ),
            )
    except Exception:
        pass


def _capture_tool_definitions(span, instance):
    """Set ``gen_ai.tool.definitions`` from an agent's tools."""
    try:
        tools = getattr(instance, "tools", None)
        if not tools:
            return
        tool_defs = []
        for t in tools[:20]:
            t_name = (
                getattr(t, "name", None)
                or getattr(t, "__name__", None)
                or type(t).__name__
            )
            entry = {"type": "function", "name": str(t_name)}
            t_desc = getattr(t, "description", None)
            if t_desc:
                entry["description"] = truncate_content(str(t_desc))
            tool_defs.append(entry)
        if tool_defs:
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_DEFINITIONS, json.dumps(tool_defs)
            )
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
    """Record OTel-compliant metrics."""
    try:
        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_type,
            SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_AGENT_FRAMEWORK,
            "service.name": application_name,
            "deployment.environment": environment,
        }
        if request_model and request_model != "unknown":
            attributes[SemanticConvention.GEN_AI_REQUEST_MODEL] = request_model
        if server_address:
            attributes[SemanticConvention.SERVER_ADDRESS] = server_address
        if server_port:
            attributes[SemanticConvention.SERVER_PORT] = server_port

        if "genai_client_operation_duration" in metrics:
            metrics["genai_client_operation_duration"].record(duration, attributes)
    except Exception:
        pass
