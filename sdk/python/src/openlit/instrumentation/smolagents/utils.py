"""
Smolagents utilities for OTel GenAI semantic convention compliant telemetry.

Follows the same patterns as the CrewAI instrumentation.
All operation names, span kinds, and attributes comply with the OTel GenAI
semantic conventions (gen-ai-agent-spans).
"""

import time
import json
import uuid
import contextvars
from opentelemetry.trace import SpanKind, Status, StatusCode
from openlit.__helpers import (
    common_framework_span_attributes,
    format_input_message,
    format_output_message,
    format_system_instructions,
    get_server_address_for_provider,
    truncate_content,
)
from openlit.semcov import SemanticConvention

# ---------------------------------------------------------------------------
# Contextvars for span deduplication and model info propagation
# ---------------------------------------------------------------------------

# Prevents double-spanning when managed agent __call__ triggers run() internally
_smolagents_agent_active = contextvars.ContextVar(
    "openlit_smolagents_agent_active", default=False
)

# Prevents double tool spans: execute_tool_call wraps Tool.__call__ internally
_smolagents_tool_call_active = contextvars.ContextVar(
    "openlit_smolagents_tool_call_active", default=False
)

# Propagates the current agent's model info to child execute_tool spans
_current_model_info = contextvars.ContextVar(
    "openlit_smolagents_model_info", default=None
)

# ---------------------------------------------------------------------------
# OTel GenAI Operation Mapping
# ---------------------------------------------------------------------------
OPERATION_MAP = {
    "agent_init": "create_agent",
    "agent_run": "invoke_agent",
    "managed_agent_call": "invoke_agent",
    "code_step": "invoke_agent",
    "tool_calling_step": "invoke_agent",
    "planning_step": "invoke_agent",
    "execute_tool_call": "execute_tool",
    "tool_call": "execute_tool",
}

# ---------------------------------------------------------------------------
# SpanKind per operation type (OTel GenAI spec)
# ---------------------------------------------------------------------------
SPAN_KIND_MAP = {
    "invoke_agent": SpanKind.INTERNAL,
    "execute_tool": SpanKind.INTERNAL,
    "create_agent": SpanKind.CLIENT,
}

_MODEL_PREFIX_TO_PROVIDER = {
    "gpt-": "openai",
    "o1": "openai",
    "o3": "openai",
    "o4": "openai",
    "davinci": "openai",
    "claude": "anthropic",
    "gemini": "google",
    "mistral": "mistral_ai",
    "command": "cohere",
    "deepseek": "deepseek",
    "llama": "groq",
    "mixtral": "groq",
    "qwen": "huggingface",
}


def get_span_kind(operation_type):
    """Return the correct SpanKind for *operation_type* per OTel GenAI spec."""
    return SPAN_KIND_MAP.get(operation_type, SpanKind.INTERNAL)


def _infer_provider_from_model(model_name):
    """Map a model name string to a provider key."""
    if not model_name:
        return None
    lower = model_name.lower()
    for prefix, provider in _MODEL_PREFIX_TO_PROVIDER.items():
        if lower.startswith(prefix):
            return provider
    return None


def _extract_model_name(instance):
    """Walk the instance hierarchy to find the LLM model name."""
    if not instance:
        return None

    # Direct model instance (Model.generate wrapping)
    model_id = getattr(instance, "model_id", None)
    if model_id:
        return str(model_id)

    # Agent instance: agent.model.model_id
    model = getattr(instance, "model", None)
    if model:
        model_id = getattr(model, "model_id", None)
        if model_id:
            return str(model_id)

    # Tool instance: inherit from parent agent via contextvar
    model_info = _current_model_info.get()
    if model_info:
        return model_info[0]

    return None


def set_server_address_and_port(instance):
    """Extract server address / port from a smolagents instance's model config."""
    server_address = ""
    server_port = 0
    try:
        model = getattr(instance, "model", None) or instance

        # Try to get base_url / api_base from client
        client = getattr(model, "client", None)
        if client:
            base_url = getattr(client, "base_url", None)
            if base_url:
                from urllib.parse import urlparse

                parsed = urlparse(str(base_url))
                server_address = parsed.hostname or ""
                server_port = parsed.port or 443

        if not server_address:
            api_base = getattr(model, "api_base", None) or getattr(
                model, "base_url", None
            )
            if api_base:
                from urllib.parse import urlparse

                parsed = urlparse(str(api_base))
                server_address = parsed.hostname or ""
                server_port = parsed.port or 443

        if not server_address:
            model_name = _extract_model_name(instance)
            provider = _infer_provider_from_model(model_name)
            if provider:
                server_address, server_port = get_server_address_for_provider(provider)

        # Tool instances: inherit from parent agent via contextvar
        if not server_address:
            model_info = _current_model_info.get()
            if model_info and len(model_info) >= 3:
                server_address = model_info[1]
                server_port = model_info[2]
    except Exception:
        pass
    return server_address, server_port


def compute_model_info(instance):
    """Return (model_name, server_address, server_port) for propagation."""
    model_name = _extract_model_name(instance)
    server_address, server_port = set_server_address_and_port(instance)
    return (model_name, server_address, server_port)


def generate_span_name(endpoint, instance, args=None, kwargs=None):
    """Return an OTel-compliant span name: ``{operation} {entity_name}``."""
    operation = OPERATION_MAP.get(endpoint, "invoke_agent")

    if endpoint == "agent_init":
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"{operation} {name}"

    if endpoint == "agent_run" or endpoint == "managed_agent_call":
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"{operation} {name}"

    if endpoint in ("code_step", "tool_calling_step"):
        name = getattr(instance, "name", None) or type(instance).__name__
        step_num = ""
        if args:
            step = args[0] if args else None
            step_number = getattr(step, "step_number", None)
            if step_number is not None:
                step_num = f" step_{step_number}"
        return f"{operation} {name}{step_num}"

    if endpoint == "planning_step":
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"{operation} {name} planning"

    if endpoint == "execute_tool_call":
        tool_name = args[0] if args else "unknown"
        return f"{operation} {tool_name}"

    if endpoint == "tool_call":
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"{operation} {name}"

    return f"{operation} {endpoint}"


# ---------------------------------------------------------------------------
# Main response processor
# ---------------------------------------------------------------------------
def process_smolagents_response(
    response,
    operation_type,
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
    instance,
    args,
    endpoint=None,
    **kwargs,
):
    """Set OTel-compliant span attributes, capture content, and record metrics."""
    end_time = time.time()

    scope = type("Scope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    request_model = _extract_model_name(instance)

    class _ModelProxy:
        def __init__(self, orig, model):
            self._original = orig
            self.model_name = model

        def __getattr__(self, name):
            return getattr(self._original, name)

    proxy = _ModelProxy(instance, request_model) if instance else None

    common_framework_span_attributes(
        scope,
        SemanticConvention.GEN_AI_SYSTEM_SMOLAGENTS,
        server_address,
        server_port,
        environment,
        application_name,
        version,
        endpoint,
        proxy,
    )

    standard_operation = OPERATION_MAP.get(endpoint, "invoke_agent")
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, standard_operation)

    _set_agent_attributes(span, instance, endpoint, capture_message_content, args=args)
    _set_tool_attributes(
        span, instance, endpoint, capture_message_content, args, kwargs, response
    )

    if capture_message_content:
        _capture_content_as_attributes(span, instance, response, endpoint, args)

    span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
    )

    if not disable_metrics and metrics:
        _record_smolagents_metrics(
            metrics,
            standard_operation,
            end_time - start_time,
            environment,
            application_name,
            request_model,
            server_address,
            server_port,
        )

    span.set_status(Status(StatusCode.OK))
    return response


# ---------------------------------------------------------------------------
# Internal helpers for setting attributes
# ---------------------------------------------------------------------------


def _set_agent_attributes(span, instance, endpoint, capture_message_content, args=None):
    """Agent attributes per OTel GenAI semantic conventions."""
    if endpoint not in (
        "agent_run",
        "managed_agent_call",
        "code_step",
        "tool_calling_step",
        "planning_step",
    ):
        return
    try:
        agent_name = getattr(instance, "name", None) or type(instance).__name__
        span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name))
        agent_id = getattr(instance, "agent_id", None) or str(id(instance))
        span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, agent_id)

        description = getattr(instance, "description", None)
        if description:
            span.set_attribute(
                SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(description)
            )

        model = getattr(instance, "model", None)
        if model:
            model_id = getattr(model, "model_id", None)
            if model_id:
                mid = str(model_id)
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, mid)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, mid)

        instructions = getattr(instance, "instructions", None)
        if instructions and capture_message_content:
            formatted = format_system_instructions(instructions)
            if formatted:
                span.set_attribute(
                    SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                    formatted,
                )

        # Tool definitions
        tools = getattr(instance, "tools", None)
        if tools:
            _set_tool_definitions(span, tools)

        # Max steps
        max_steps = getattr(instance, "max_steps", None)
        if max_steps is not None:
            span.set_attribute("gen_ai.smolagents.max_steps", max_steps)

        # Step number for step-level spans
        if endpoint in ("code_step", "tool_calling_step") and args:
            step = args[0] if args else None
            step_number = getattr(step, "step_number", None)
            if step_number is not None:
                span.set_attribute("gen_ai.smolagents.step_number", step_number)
    except Exception:
        pass


def _resolve_tool_call_id(args, kwargs):
    """Best-effort tool call id from invocation; UUID if none found."""
    if kwargs:
        for key in ("tool_call_id", "id", "call_id", "tool_use_id"):
            val = kwargs.get(key)
            if val is not None and str(val).strip():
                return str(val)
    if args and len(args) > 1:
        tool_args = args[1]
        if isinstance(tool_args, dict):
            for key in ("tool_call_id", "id", "call_id", "tool_use_id"):
                val = tool_args.get(key)
                if val is not None and str(val).strip():
                    return str(val)
    return str(uuid.uuid4())


def _set_tool_attributes(
    span, instance, endpoint, capture_message_content, args, kwargs, response
):
    """Tool attributes per OTel GenAI semantic conventions."""
    if endpoint not in ("tool_call", "execute_tool_call"):
        return
    try:
        if endpoint == "execute_tool_call":
            tool_name = args[0] if args else "unknown"
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, str(tool_name))
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, "function")
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_ID,
                _resolve_tool_call_id(args, kwargs or {}),
            )

            # Try to get tool description from agent's tools dict
            tools = getattr(instance, "tools", None) or {}
            managed = getattr(instance, "managed_agents", None) or {}
            all_tools = {**tools, **managed}
            tool = all_tools.get(tool_name)
            if tool:
                desc = getattr(tool, "description", None)
                if desc:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
                        truncate_content(str(desc)),
                    )

            if capture_message_content:
                tool_args = args[1] if len(args) > 1 else None
                if tool_args:
                    try:
                        arg_str = (
                            json.dumps(tool_args)
                            if isinstance(tool_args, (dict, list))
                            else str(tool_args)
                        )
                    except (TypeError, ValueError):
                        arg_str = str(tool_args)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                        truncate_content(arg_str),
                    )
                if response is not None:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                        truncate_content(str(response)),
                    )

        elif endpoint == "tool_call":
            name = getattr(instance, "name", None) or type(instance).__name__
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, str(name))
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, "function")
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_CALL_ID,
                _resolve_tool_call_id(args, kwargs or {}),
            )

            desc = getattr(instance, "description", None)
            if desc:
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
                    truncate_content(str(desc)),
                )

            if capture_message_content:
                if args or kwargs:
                    try:
                        call_args = (
                            kwargs
                            if kwargs
                            else (args[0] if len(args) == 1 else list(args))
                        )
                        arg_str = json.dumps(call_args)
                    except (TypeError, ValueError):
                        arg_str = str(args) if args else str(kwargs)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                        truncate_content(arg_str),
                    )
                if response is not None:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                        truncate_content(str(response)),
                    )
    except Exception:
        pass


def _set_tool_definitions(span, tools):
    """Set gen_ai.tool.definitions from agent's tools dict."""
    if not tools:
        return
    try:
        tool_list = tools.values() if isinstance(tools, dict) else tools
        tool_defs = []
        for tool in list(tool_list)[:10]:
            entry = {"type": "function"}
            name = getattr(tool, "name", None)
            if name:
                entry["name"] = str(name)
            desc = getattr(tool, "description", None)
            if desc:
                entry["description"] = truncate_content(str(desc))
            inputs = getattr(tool, "inputs", None)
            if inputs:
                entry["parameters"] = inputs
            if len(entry) > 1:
                tool_defs.append(entry)
        if tool_defs:
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_DEFINITIONS, json.dumps(tool_defs)
            )
    except Exception:
        pass


def _capture_content_as_attributes(span, instance, response, endpoint, args=None):
    """Record input/output as span attributes (JSON)."""
    try:
        if endpoint in ("agent_run", "managed_agent_call"):
            task = None
            if args:
                task = args[0] if args else None
                if task and hasattr(task, "task"):
                    task = task.task
            if not task:
                task = getattr(instance, "task", None)
            if task:
                span.set_attribute(
                    SemanticConvention.GEN_AI_INPUT_MESSAGES,
                    json.dumps([format_input_message("user", task)]),
                )

        if response is not None and endpoint in ("agent_run", "managed_agent_call"):
            span.set_attribute(
                SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                json.dumps([format_output_message(response)]),
            )
    except Exception:
        pass


def emit_create_agent_span(
    tracer,
    instance,
    version,
    environment,
    application_name,
    capture_message_content,
):
    """Emit a ``create_agent`` span for a smolagents agent instance.

    Returns the SpanContext so the caller can store it on
    ``instance._openlit_creation_context`` for linking from
    ``invoke_agent`` spans.
    """
    try:
        agent_name = getattr(instance, "name", None) or type(instance).__name__
        span_name = f"create_agent {agent_name}"

        server_address, server_port = set_server_address_and_port(instance)

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            span.set_attribute(
                SemanticConvention.GEN_AI_OPERATION,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_PROVIDER_NAME,
                SemanticConvention.GEN_AI_SYSTEM_SMOLAGENTS,
            )
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name))
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, str(id(instance)))

            description = getattr(instance, "description", None)
            if description:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                    str(description),
                )

            model = getattr(instance, "model", None)
            if model:
                model_id = getattr(model, "model_id", None)
                if model_id:
                    mid = str(model_id)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, mid)
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, mid)

            instructions = getattr(instance, "instructions", None)
            if instructions and capture_message_content:
                formatted = format_system_instructions(instructions)
                if formatted:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                        formatted,
                    )

            tools = getattr(instance, "tools", None)
            if tools:
                _set_tool_definitions(span, tools)

            if server_address:
                span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
            if server_port:
                span.set_attribute(SemanticConvention.SERVER_PORT, server_port)

            span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
            span.set_attribute(
                SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
            )
            span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)
            span.set_status(Status(StatusCode.OK))

            return span.get_span_context()
    except Exception:
        return None


def _record_smolagents_metrics(
    metrics,
    operation_type,
    duration,
    environment,
    application_name,
    request_model,
    server_address,
    server_port,
):
    """Record OTel-compliant metrics with correct attribute keys."""
    try:
        attributes = {
            SemanticConvention.GEN_AI_OPERATION: operation_type,
            SemanticConvention.GEN_AI_PROVIDER_NAME: (
                SemanticConvention.GEN_AI_SYSTEM_SMOLAGENTS
            ),
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
