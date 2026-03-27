"""
Google ADK utilities for OTel GenAI semantic convention compliant telemetry.

Follows the same patterns as the CrewAI / LangGraph / OpenAI Agents
instrumentations.  All operation names, span kinds, and attributes comply
with the OTel GenAI semantic conventions (gen-ai-spans.md,
gen-ai-agent-spans.md).

Key technique: ``_PassthroughTracer`` (adopted from OpenInference) replaces
ADK's internal tracers so that OpenLIT controls span creation for
``invoke_agent`` (both Runner and BaseAgent), while ADK's ``call_llm``,
``generate_content``, and ``execute_tool`` spans remain as children enriched
via decorator-style wrappers on ADK's tracing functions.
"""

import os
import json
import time
from contextvars import ContextVar
from contextlib import contextmanager

import wrapt
from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import (
    common_framework_span_attributes,
    handle_exception,
    truncate_content,
    truncate_message_content,
)
from openlit.semcov import SemanticConvention

# Deduplication: prevents Runner.run_async from creating a second workflow
# span when called internally by Runner.run.
_ADK_WORKFLOW_ACTIVE: ContextVar[bool] = ContextVar(
    "_adk_workflow_active", default=False
)

# ---------------------------------------------------------------------------
# OTel GenAI operation mapping
# ---------------------------------------------------------------------------
OPERATION_MAP = {
    "agent_init": SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
    "runner_run_async": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "runner_run": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "runner_run_live": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "agent_run_async": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
}

# ---------------------------------------------------------------------------
# SpanKind per operation (OTel GenAI spec)
# ---------------------------------------------------------------------------
SPAN_KIND_MAP = {
    SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT: SpanKind.CLIENT,
    SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT: SpanKind.CLIENT,
}


def get_operation_type(endpoint):
    """Return the standard ``gen_ai.operation.name`` for an ADK endpoint."""
    return OPERATION_MAP.get(endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT)


def get_span_kind(operation_type):
    """Return the correct ``SpanKind`` per OTel GenAI spec."""
    return SPAN_KIND_MAP.get(operation_type, SpanKind.INTERNAL)


# ---------------------------------------------------------------------------
# Span name generation
# ---------------------------------------------------------------------------
def generate_span_name(endpoint, instance, args=None, kwargs=None):
    """Return an OTel-compliant span name: ``{operation} {entity_name}``."""
    operation = get_operation_type(endpoint)

    if endpoint == "agent_init":
        name = getattr(instance, "name", None) or "agent"
        return f"create_agent {name}"

    if endpoint in ("runner_run_async", "runner_run", "runner_run_live"):
        app_name = (
            getattr(instance, "app_name", None)
            or getattr(instance, "_app_name", None)
            or "google_adk"
        )
        return f"invoke_agent {app_name}"

    if endpoint == "agent_run_async":
        name = getattr(instance, "name", None) or "agent"
        return f"invoke_agent {name}"

    return f"{operation} {endpoint}"


# ---------------------------------------------------------------------------
# _PassthroughTracer
# ---------------------------------------------------------------------------
class _PassthroughTracer(wrapt.ObjectProxy):
    """Drop-in replacement for ADK's ``tracer`` objects.

    Overrides ``start_as_current_span`` to yield the **current** span
    instead of creating a new one.  This lets OpenLIT own top-level spans
    while ADK's tracing code still runs (setting attributes, etc.) on
    OpenLIT's spans.
    """

    @contextmanager
    def start_as_current_span(self, *args, **kwargs):
        yield trace.get_current_span()


# ---------------------------------------------------------------------------
# Server address resolution
# ---------------------------------------------------------------------------
_NON_GOOGLE_PROVIDERS = {
    "anthropic": ("api.anthropic.com", 443, "anthropic"),
    "claude": ("api.anthropic.com", 443, "anthropic"),
    "openai": ("api.openai.com", 443, "openai"),
    "gpt": ("api.openai.com", 443, "openai"),
    "mistral": ("api.mistral.ai", 443, "mistral"),
    "cohere": ("api.cohere.ai", 443, "cohere"),
}


def _detect_provider_from_model_str(model_str):
    """Detect non-Google provider from a model name string like ``anthropic/claude-...``."""
    if not model_str:
        return None
    lower = model_str.lower()
    prefix = lower.split("/")[0] if "/" in lower else lower.split("-")[0]
    return _NON_GOOGLE_PROVIDERS.get(prefix)


def resolve_server_info(instance=None, model_name=None):
    """Return ``(server_address, server_port, provider_name)`` for Google ADK.

    Attempts to detect the backend from a model name string or the
    agent/runner instance's model object (e.g. LiteLlm with a
    non-Google model).  Falls back to the ``GOOGLE_GENAI_USE_VERTEXAI``
    env var to distinguish Vertex AI from Gemini API.
    """
    if model_name:
        detected = _detect_provider_from_model_str(model_name)
        if detected:
            return detected

    if instance is not None:
        try:
            model_obj = getattr(instance, "model", None)
            if model_obj is None:
                agent = getattr(instance, "agent", None)
                if agent:
                    model_obj = getattr(agent, "model", None)
            if model_obj:
                resolved = _resolve_model_string(model_obj)
                if resolved:
                    detected = _detect_provider_from_model_str(resolved)
                    if detected:
                        return detected
        except Exception:
            pass

    if os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("true", "1"):
        return "aiplatform.googleapis.com", 443, "gcp.vertex_ai"
    return "generativelanguage.googleapis.com", 443, "gcp.gemini"


# ---------------------------------------------------------------------------
# Model extraction
# ---------------------------------------------------------------------------
def _resolve_model_string(model_obj):
    """Extract the model name string from a model object (e.g. LiteLlm, BaseLlm).

    Handles Pydantic model objects where ``.model`` is a ``str`` field,
    as well as objects with a ``model_name`` attribute.
    """
    if isinstance(model_obj, str):
        return model_obj
    model_name = getattr(model_obj, "model_name", None)
    if model_name and isinstance(model_name, str):
        return model_name
    inner_model = getattr(model_obj, "model", None)
    if inner_model and isinstance(inner_model, str):
        return inner_model
    return None


def extract_model_name(instance):
    """Best-effort model name extraction from an ADK agent/runner instance."""
    try:
        model = getattr(instance, "model", None)
        if model:
            resolved = _resolve_model_string(model)
            if resolved:
                return resolved

        root_agent = getattr(instance, "agent", None)
        if root_agent:
            return extract_model_name(root_agent)
    except Exception:
        pass
    return "unknown"


# ---------------------------------------------------------------------------
# Content capture helpers
# ---------------------------------------------------------------------------
def _extract_parts(parts):
    """Extract text, function_call, and function_response data from Content parts."""
    text_parts = []
    tool_calls = []
    tool_responses = []
    for part in parts or []:
        text = getattr(part, "text", None)
        if text:
            text_parts.append(truncate_content(str(text)))

        fc = getattr(part, "function_call", None)
        if fc:
            call_entry = {"name": getattr(fc, "name", ""), "id": getattr(fc, "id", "")}
            fc_args = getattr(fc, "args", None)
            if fc_args:
                try:
                    call_entry["arguments"] = (
                        json.dumps(fc_args)
                        if isinstance(fc_args, dict)
                        else str(fc_args)
                    )
                except (TypeError, ValueError):
                    call_entry["arguments"] = str(fc_args)
            tool_calls.append(call_entry)

        fr = getattr(part, "function_response", None)
        if fr:
            resp_entry = {"name": getattr(fr, "name", ""), "id": getattr(fr, "id", "")}
            fr_resp = getattr(fr, "response", None)
            if fr_resp is not None:
                try:
                    resp_entry["content"] = (
                        json.dumps(fr_resp)
                        if isinstance(fr_resp, dict)
                        else str(fr_resp)
                    )
                except (TypeError, ValueError):
                    resp_entry["content"] = str(fr_resp)
            tool_responses.append(resp_entry)

    return text_parts, tool_calls, tool_responses


def capture_input_messages(span, llm_request, capture_message_content):
    """Set ``gen_ai.input.messages`` from an ADK ``LlmRequest``.

    Produces the OTel parts-based schema:
    ``[{"role": ..., "parts": [{"type": "text", "content": ...}, ...]}]``
    """
    if not capture_message_content:
        return
    try:
        contents = getattr(llm_request, "contents", None)
        if not contents:
            return
        messages = []
        for content in contents[:20]:
            role = getattr(content, "role", "user")
            raw_parts = getattr(content, "parts", [])
            text_parts, tool_calls, tool_responses = _extract_parts(raw_parts)

            parts = []
            for text in text_parts:
                parts.append({"type": "text", "content": text})
            for tc in tool_calls:
                parts.append(
                    {
                        "type": "tool_call",
                        "id": tc.get("id", ""),
                        "name": tc.get("name", ""),
                        "arguments": tc.get("arguments", ""),
                    }
                )
            for tr in tool_responses:
                parts.append(
                    {
                        "type": "tool_call_response",
                        "id": tr.get("id", ""),
                        "response": tr.get("content", ""),
                    }
                )
            if parts:
                messages.append({"role": str(role), "parts": parts})
        if messages:
            truncate_message_content(messages)
            span.set_attribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES, json.dumps(messages)
            )
    except Exception:
        pass


def capture_output_messages(
    span, llm_response, capture_message_content, finish_reason="stop"
):
    """Set ``gen_ai.output.messages`` from an ADK ``LlmResponse``.

    Produces the OTel parts-based schema with ``finish_reason``:
    ``[{"role": "assistant", "parts": [...], "finish_reason": "stop"}]``
    """
    if not capture_message_content:
        return
    try:
        content = getattr(llm_response, "content", None)
        if not content:
            return
        raw_parts = getattr(content, "parts", [])
        text_parts, tool_calls, _ = _extract_parts(raw_parts)

        parts = []
        for text in text_parts:
            parts.append({"type": "text", "content": text})
        for tc in tool_calls:
            parts.append(
                {
                    "type": "tool_call",
                    "id": tc.get("id", ""),
                    "name": tc.get("name", ""),
                    "arguments": tc.get("arguments", ""),
                }
            )
        if parts:
            messages = [
                {"role": "assistant", "parts": parts, "finish_reason": finish_reason}
            ]
            truncate_message_content(messages)
            span.set_attribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                json.dumps(messages),
            )
    except Exception:
        pass


def capture_event_output(span, event, capture_message_content):
    """Capture final response output from an ADK ``Event``.

    Produces the OTel parts-based schema with ``finish_reason``:
    ``[{"role": "assistant", "parts": [...], "finish_reason": "stop"}]``
    """
    if not capture_message_content:
        return
    try:
        content = getattr(event, "content", None)
        if not content:
            return
        raw_parts = getattr(content, "parts", [])
        text_parts, tool_calls, _ = _extract_parts(raw_parts)

        parts = []
        for text in text_parts:
            parts.append({"type": "text", "content": text})
        for tc in tool_calls:
            parts.append(
                {
                    "type": "tool_call",
                    "id": tc.get("id", ""),
                    "name": tc.get("name", ""),
                    "arguments": tc.get("arguments", ""),
                }
            )
        if parts:
            messages = [{"role": "assistant", "parts": parts, "finish_reason": "stop"}]
            truncate_message_content(messages)
            span.set_attribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                json.dumps(messages),
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Token extraction
# ---------------------------------------------------------------------------
def extract_token_usage(llm_response):
    """Return token usage tuple from an ADK response.

    Returns ``(input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens)``.
    ``output_tokens`` is ``candidates_token_count`` only (excluding reasoning).
    ``reasoning_tokens`` is ``thoughts_token_count`` separately.
    """
    try:
        usage = getattr(llm_response, "usage_metadata", None)
        if not usage:
            return None, None, None, None, None
        input_tokens = getattr(usage, "prompt_token_count", None)
        output_tokens = getattr(usage, "candidates_token_count", None)
        reasoning_tokens = getattr(usage, "thoughts_token_count", None)
        cached_tokens = getattr(usage, "cached_content_token_count", None)
        total_tokens = getattr(usage, "total_token_count", None)
        return (
            input_tokens,
            output_tokens,
            reasoning_tokens,
            cached_tokens,
            total_tokens,
        )
    except Exception:
        return None, None, None, None, None


# ---------------------------------------------------------------------------
# LLM span enrichment (called from trace_call_llm wrapper)
# ---------------------------------------------------------------------------
def enrich_llm_span(span, llm_request, llm_response, capture_message_content):
    """Add OTel GenAI semantic convention attributes to an ADK ``call_llm`` span."""
    try:
        request_model = getattr(llm_request, "model", None) if llm_request else None
        model_str = str(request_model) if request_model else None
        server_address, server_port, provider_name = resolve_server_info(
            model_name=model_str
        )

        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        )
        span.set_attribute(SemanticConvention.GEN_AI_PROVIDER_NAME, provider_name)
        span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
        span.set_attribute(SemanticConvention.SERVER_PORT, server_port)

        if llm_request:
            if model_str:
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_str)
            config = getattr(llm_request, "config", None)
            if config:
                temp = getattr(config, "temperature", None)
                if temp is not None:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, float(temp)
                    )
                top_p = getattr(config, "top_p", None)
                if top_p is not None:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_REQUEST_TOP_P, float(top_p)
                    )
                max_tokens = getattr(config, "max_output_tokens", None)
                if max_tokens is not None:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, int(max_tokens)
                    )
            if capture_message_content:
                config = config or getattr(llm_request, "config", None)
                sys_instr = (
                    getattr(config, "system_instruction", None) if config else None
                )
                if sys_instr:
                    instr_text = (
                        str(sys_instr) if not isinstance(sys_instr, str) else sys_instr
                    )
                    span.set_attribute(
                        SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                        json.dumps(
                            [
                                {
                                    "type": "text",
                                    "content": truncate_content(instr_text),
                                }
                            ]
                        ),
                    )
            capture_input_messages(span, llm_request, capture_message_content)

        if llm_response:
            (
                input_tokens,
                output_tokens,
                reasoning_tokens,
                cached_tokens,
                total_tokens,
            ) = extract_token_usage(llm_response)
            if input_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
                )
            if output_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
                )
            if reasoning_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_COMPLETION_TOKENS_DETAILS_REASONING,
                    reasoning_tokens,
                )
            if cached_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
                    cached_tokens,
                )
            if total_tokens is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, total_tokens
                )

            response_model = getattr(llm_response, "model_version", None)
            if response_model:
                span.set_attribute(
                    SemanticConvention.GEN_AI_RESPONSE_MODEL, str(response_model)
                )

            fr_str = "stop"
            finish_reason = getattr(llm_response, "finish_reason", None)
            if finish_reason:
                try:
                    fr_str = finish_reason.value.lower()
                except AttributeError:
                    fr_str = str(finish_reason).lower()
                span.set_attribute(
                    SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
                    [fr_str],
                )

            response_id = getattr(llm_response, "response_id", None) or getattr(
                llm_response, "id", None
            )
            if response_id:
                span.set_attribute(
                    SemanticConvention.GEN_AI_RESPONSE_ID, str(response_id)
                )

            error_code = getattr(llm_response, "error_code", None)
            if error_code:
                span.set_attribute(SemanticConvention.ERROR_TYPE, str(error_code))
                error_message = getattr(llm_response, "error_message", None)
                if error_message:
                    span.set_status(Status(StatusCode.ERROR, str(error_message)))

            capture_output_messages(span, llm_response, capture_message_content, fr_str)

            span.set_attribute(
                SemanticConvention.GEN_AI_OUTPUT_TYPE,
                _determine_output_type(llm_response),
            )

    except Exception:
        pass


# ---------------------------------------------------------------------------
# ADK Event -> function response extraction
# ---------------------------------------------------------------------------
def _determine_output_type(llm_response):
    """Determine the output type from an LLM response: ``text`` or ``tool_calls``."""
    try:
        content = getattr(llm_response, "content", None)
        if content:
            for part in getattr(content, "parts", []) or []:
                if getattr(part, "function_call", None):
                    return "tool_calls"
    except Exception:
        pass
    return "text"


def _extract_from_event(event_obj):
    """Extract ``(response_dict, tool_call_id)`` from an ADK ``Event``.

    ADK's ``trace_tool_call`` passes a ``function_response_event`` (an Event)
    whose response payload lives at
    ``event.content.parts[0].function_response.response`` and the tool call
    ID at ``event.content.parts[0].function_response.id``.
    """
    try:
        content = getattr(event_obj, "content", None)
        if content is None:
            return None, None
        parts = getattr(content, "parts", None)
        if not parts or len(parts) == 0:
            return None, None
        fn_resp = getattr(parts[0], "function_response", None)
        if fn_resp is None:
            return None, None
        resp = getattr(fn_resp, "response", None)
        call_id = getattr(fn_resp, "id", None)
        return resp, call_id
    except Exception:
        return None, None


def _is_adk_event(obj):
    """Return True if *obj* looks like a ``google.adk.events.event.Event``."""
    cls_qual = getattr(type(obj), "__qualname__", "")
    return cls_qual == "Event" and hasattr(obj, "content")


# ---------------------------------------------------------------------------
# Tool span enrichment (called from trace_tool_call wrapper)
# ---------------------------------------------------------------------------
def enrich_tool_span(
    span,
    tool,
    function_args,
    function_response_event,
    capture_message_content,
    error=None,
):
    """Add OTel GenAI semantic convention attributes to an ADK ``execute_tool`` span.

    ``function_response_event`` is the raw ADK ``Event`` passed by
    ``trace_tool_call``.  We extract the actual response dict and tool-call
    ID from it.
    """
    try:
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_PROVIDER_NAME,
            SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
        )

        if tool:
            tool_name = getattr(tool, "name", None) or type(tool).__name__
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, str(tool_name))
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, type(tool).__name__)
            tool_desc = getattr(tool, "description", None)
            if tool_desc:
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
                    truncate_content(str(tool_desc)),
                )

        response_dict, tool_call_id = None, None
        if _is_adk_event(function_response_event):
            response_dict, tool_call_id = _extract_from_event(function_response_event)
        elif isinstance(function_response_event, dict):
            response_dict = function_response_event
            tool_call_id = function_response_event.get("id")

        if capture_message_content:
            if function_args is not None:
                try:
                    args_str = (
                        json.dumps(function_args)
                        if isinstance(function_args, dict)
                        else str(function_args)
                    )
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                        truncate_content(args_str),
                    )
                except (TypeError, ValueError):
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                        truncate_content(str(function_args)),
                    )

            if response_dict is not None:
                try:
                    result_str = (
                        json.dumps(response_dict)
                        if isinstance(response_dict, dict)
                        else str(response_dict)
                    )
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                        truncate_content(result_str),
                    )
                except (TypeError, ValueError):
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                        truncate_content(str(response_dict)),
                    )

        if tool_call_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_ID, str(tool_call_id)
            )

        if error is not None:
            error_type = type(error).__name__ if type(error).__name__ else "_OTHER"
            span.set_attribute(SemanticConvention.ERROR_TYPE, error_type)
            span.set_status(Status(StatusCode.ERROR, str(error)))

    except Exception:
        pass


# ---------------------------------------------------------------------------
# Merged tool span enrichment (called from trace_merged_tool_calls wrapper)
# ---------------------------------------------------------------------------
def enrich_merged_tool_span(
    span, response_event_id, function_response_event, capture_message_content
):
    """Add OTel GenAI semantic convention attributes to a merged ``execute_tool`` span."""
    try:
        span.set_attribute(
            SemanticConvention.GEN_AI_OPERATION,
            SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
        )
        span.set_attribute(
            SemanticConvention.GEN_AI_PROVIDER_NAME,
            SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
        )
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, "(merged tools)")

        if response_event_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_ID, str(response_event_id)
            )

        if capture_message_content and function_response_event is not None:
            try:
                content = getattr(function_response_event, "content", None)
                if content:
                    parts = getattr(content, "parts", []) or []
                    tool_results = []
                    for part in parts:
                        fn_resp = getattr(part, "function_response", None)
                        if fn_resp:
                            resp = getattr(fn_resp, "response", None)
                            name = getattr(fn_resp, "name", None)
                            entry = {}
                            if name:
                                entry["name"] = str(name)
                            if resp is not None:
                                entry["response"] = resp
                            if entry:
                                tool_results.append(entry)
                    if tool_results:
                        span.set_attribute(
                            SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                            truncate_content(json.dumps(tool_results)),
                        )
            except (TypeError, ValueError):
                pass

    except Exception:
        pass


# ---------------------------------------------------------------------------
# Response processor for Runner/Agent spans
# ---------------------------------------------------------------------------
def process_google_adk_response(
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
):
    """Set OTel-compliant span attributes and record metrics for a completed span."""
    end_time = time.time()

    operation_type = get_operation_type(endpoint)
    server_address, server_port, _ = resolve_server_info(instance)
    request_model = extract_model_name(instance)

    scope = type("Scope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    model_proxy = (
        type("P", (), {"model_name": request_model})() if request_model else None
    )

    common_framework_span_attributes(
        scope,
        SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
        server_address,
        server_port,
        environment,
        application_name,
        version,
        operation_type,
        model_proxy,
    )

    if endpoint in ("runner_run_async", "runner_run", "runner_run_live"):
        _set_runner_agent_attributes(span, instance, endpoint)
    elif endpoint == "agent_run_async":
        _set_agent_attributes(span, instance)

    span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
    )

    if not disable_metrics and metrics:
        record_google_adk_metrics(
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
def _set_runner_agent_attributes(span, instance, endpoint):
    """Set attributes for Runner ``invoke_agent`` spans."""
    try:
        app_name = (
            getattr(instance, "app_name", None)
            or getattr(instance, "_app_name", None)
            or "google_adk"
        )
        span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(app_name))

        if endpoint == "runner_run_live":
            span.set_attribute(SemanticConvention.GEN_AI_EXECUTION_MODE, "live")
        elif endpoint == "runner_run":
            span.set_attribute(SemanticConvention.GEN_AI_EXECUTION_MODE, "sync")
        else:
            span.set_attribute(SemanticConvention.GEN_AI_EXECUTION_MODE, "async")
    except Exception:
        pass


def _set_agent_attributes(span, instance):
    """Set attributes for ``invoke_agent`` (BaseAgent.run_async) spans."""
    try:
        name = getattr(instance, "name", None)
        if name:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))

        description = getattr(instance, "description", None)
        if description:
            span.set_attribute(
                SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(description)
            )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def record_google_adk_metrics(
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
            SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
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
