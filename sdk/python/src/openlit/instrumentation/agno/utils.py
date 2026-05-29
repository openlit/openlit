"""
Agno utilities for OTel GenAI semantic convention compliant telemetry.

Follows the same patterns as the CrewAI / OpenAI Agents instrumentations.
All operation names, span kinds, and attributes comply with the OTel GenAI
semantic conventions (gen-ai-spans.md, gen-ai-agent-spans.md).
"""

import importlib
import inspect
import json
import logging
import time
import contextvars

from opentelemetry.trace import SpanKind, Status, StatusCode

from openlit.__helpers import (
    common_framework_span_attributes,
    format_input_message,
    format_output_message,
    format_system_instructions,
    get_server_address_for_provider,
    truncate_content,
    _apply_custom_span_attributes,
)
from openlit.semcov import SemanticConvention

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Contextvars for span deduplication
# ---------------------------------------------------------------------------
_agno_team_active = contextvars.ContextVar("openlit_agno_team_active", default=False)
_agno_workflow_active = contextvars.ContextVar(
    "openlit_agno_workflow_active", default=False
)

# Propagates the executing agent's model info to child execute_tool spans
_current_agent_model_info = contextvars.ContextVar(
    "openlit_agno_agent_model_info", default=None
)

# Stores the parent agent instance so child tool spans can lazily
# read session_id (set by Agno mid-run, not available before wrapped())
_agno_parent_agent = contextvars.ContextVar("openlit_agno_parent_agent", default=None)

# ---------------------------------------------------------------------------
# OTel GenAI Operation Mapping
# ---------------------------------------------------------------------------
OPERATION_MAP = {
    "agent_init": SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
    "agent_run": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "agent_arun": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "agent_continue_run": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "agent_acontinue_run": SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT,
    "team_run": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "team_arun": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "workflow_run": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "workflow_arun": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "tool_execute": SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
    "tool_aexecute": SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS,
    "vectordb_search": "retrieval",
    "vectordb_upsert": "upsert",
    "knowledge_search": "retrieval",
    "knowledge_add": "knowledge_add",
    "memory_add": SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY,
    "memory_search": SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY,
}

# ---------------------------------------------------------------------------
# SpanKind per operation type (OTel GenAI spec)
# ---------------------------------------------------------------------------
SPAN_KIND_MAP = {
    SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS: SpanKind.INTERNAL,
    SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT: SpanKind.CLIENT,
    "retrieval": SpanKind.CLIENT,
    "upsert": SpanKind.CLIENT,
    "knowledge_add": SpanKind.CLIENT,
    SemanticConvention.GEN_AI_OPERATION_TYPE_MEMORY: SpanKind.INTERNAL,
}


def get_span_kind(operation_type):
    """Return the correct SpanKind for *operation_type* per OTel GenAI spec."""
    return SPAN_KIND_MAP.get(operation_type, SpanKind.INTERNAL)


# ---------------------------------------------------------------------------
# Model name / server resolution
# ---------------------------------------------------------------------------
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
}


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

    model = getattr(instance, "model", None)
    if model:
        model_id = getattr(model, "id", None)
        if model_id:
            return str(model_id)
        model_name = getattr(model, "name", None)
        if model_name:
            return str(model_name)

    # For teams, walk members/agents to find first model
    for attr in ("members", "agents"):
        agents = getattr(instance, attr, None)
        if agents:
            for ag in agents:
                ag_model = getattr(ag, "model", None)
                if ag_model:
                    mid = getattr(ag_model, "id", None) or getattr(
                        ag_model, "name", None
                    )
                    if mid:
                        return str(mid)

    # Tool instances: inherit from parent agent via contextvar
    model_info = _current_agent_model_info.get()
    if model_info:
        return model_info[0]

    return None


def set_server_address_and_port(instance):
    """Extract server address / port from an Agno instance's model config.

    Falls back to PROVIDER_DEFAULT_ENDPOINTS when no explicit api_base is set.
    """
    server_address = ""
    server_port = 0
    try:
        model = getattr(instance, "model", None)

        # Walk to find a model in teams/agents
        if not model:
            for attr in ("members", "agents"):
                agents = getattr(instance, attr, None)
                if agents:
                    for ag in agents:
                        model = getattr(ag, "model", None)
                        if model:
                            break
                    if model:
                        break

        if model:
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
            model_info = _current_agent_model_info.get()
            if model_info:
                server_address = model_info[1]
                server_port = model_info[2]
    except Exception:
        pass
    return server_address, server_port


def _compute_agent_model_info(instance):
    """Return (model_name, server_address, server_port) for an agent."""
    model_name = _extract_model_name(instance)
    server_address, server_port = set_server_address_and_port(instance)
    return (model_name, server_address, server_port)


# ---------------------------------------------------------------------------
# Span name generation
# ---------------------------------------------------------------------------
def generate_span_name(endpoint, instance, args=None, kwargs=None):
    """Return an OTel-compliant span name: ``{operation} {entity_name}``."""
    operation = OPERATION_MAP.get(
        endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
    )

    if endpoint == "agent_init":
        name = getattr(instance, "name", None) or "agent"
        return f"{operation} {name}"

    if endpoint.startswith("agent_"):
        name = (
            getattr(instance, "name", None)
            or getattr(instance, "agent_id", None)
            or "agent"
        )
        return f"{operation} {name}"

    if endpoint.startswith("team_"):
        name = getattr(instance, "name", None) or "team"
        return f"{operation} {name}"

    if endpoint.startswith("workflow_"):
        name = getattr(instance, "name", None) or "workflow"
        return f"{operation} {name}"

    if endpoint.startswith("tool_"):
        func = getattr(instance, "function", None)
        name = getattr(func, "name", None) if func else None
        if not name:
            name = getattr(instance, "name", None) or "tool"
        return f"{operation} {name}"

    if endpoint.startswith("vectordb_"):
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"{operation} {name}"

    if endpoint.startswith("knowledge_"):
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"{operation} {name}"

    if endpoint.startswith("memory_"):
        op_suffix = endpoint.replace("memory_", "")
        return f"{operation} {op_suffix}"

    return f"{operation} {endpoint}"


# ---------------------------------------------------------------------------
# Token usage extraction
# ---------------------------------------------------------------------------
def _extract_token_usage(response):
    """Extract token metrics from RunOutput.metrics or TeamRunOutput.metrics."""
    input_tokens = 0
    output_tokens = 0
    try:
        metrics = getattr(response, "metrics", None)
        if metrics:
            input_tokens = getattr(metrics, "input_tokens", 0) or 0
            output_tokens = getattr(metrics, "output_tokens", 0) or 0
    except Exception:
        pass
    return input_tokens, output_tokens


# ---------------------------------------------------------------------------
# Entity-specific attribute setters
# ---------------------------------------------------------------------------
def _set_agent_attributes(span, instance, endpoint, capture_message_content):
    """Set agent-specific attributes per OTel GenAI semantic conventions."""
    if not endpoint.startswith("agent_"):
        return
    try:
        agent_name = (
            getattr(instance, "name", None)
            or getattr(instance, "agent_id", None)
            or "agent"
        )
        span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name))

        agent_id = getattr(instance, "agent_id", None) or getattr(instance, "id", None)
        if agent_id:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, str(agent_id))

        description = getattr(instance, "description", None)
        if description:
            span.set_attribute(
                SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                truncate_content(str(description)),
            )

        instructions = getattr(instance, "instructions", None)
        if instructions and capture_message_content:
            formatted = format_system_instructions(instructions)
            if formatted:
                span.set_attribute(
                    SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                    formatted,
                )

        _set_tool_definitions(span, getattr(instance, "tools", None) or [])

        # Session / conversation ID
        session_id = getattr(instance, "session_id", None)
        if session_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID, str(session_id)
            )

        user_id = getattr(instance, "user_id", None)
        if user_id:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER, str(user_id))
    except Exception:
        pass


def _set_team_attributes(span, instance, endpoint):
    """Set team-specific attributes (teams are workflows in OTel)."""
    if not endpoint.startswith("team_"):
        return
    try:
        team_name = getattr(instance, "name", None) or "team"
        span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, str(team_name))

        session_id = getattr(instance, "session_id", None)
        if session_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID, str(session_id)
            )

        members = getattr(instance, "members", None) or getattr(
            instance, "agents", None
        )
        if members:
            agent_names = []
            for m in members[:10]:
                name = getattr(m, "name", None) or "unknown"
                agent_names.append(str(name))
            if agent_names:
                span.set_attribute("gen_ai.agno.team.agents", json.dumps(agent_names))
    except Exception:
        pass


def _set_workflow_attributes(span, instance, endpoint):
    """Set workflow-specific attributes."""
    if not endpoint.startswith("workflow_"):
        return
    try:
        wf_name = getattr(instance, "name", None) or "workflow"
        span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, str(wf_name))

        session_id = getattr(instance, "session_id", None)
        if session_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID, str(session_id)
            )

        description = getattr(instance, "description", None)
        if description:
            span.set_attribute(
                SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                truncate_content(str(description)),
            )
    except Exception:
        pass


def _set_tool_attributes(
    span, instance, endpoint, capture_message_content, args, kwargs, response
):
    """Set tool attributes per OTel GenAI semantic conventions.

    Returns True if the tool execution had an error, False otherwise.
    """
    if not endpoint.startswith("tool_"):
        return False
    tool_errored = False
    try:
        func = getattr(instance, "function", None)
        tool_name = getattr(func, "name", None) if func else None
        if not tool_name:
            tool_name = getattr(instance, "name", None) or "tool"
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, str(tool_name))
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, "function")

        call_id = getattr(instance, "call_id", None)
        if call_id:
            span.set_attribute(SemanticConvention.GEN_AI_TOOL_CALL_ID, str(call_id))

        tool_desc = getattr(func, "description", None) if func else None
        if tool_desc:
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
                truncate_content(str(tool_desc)),
            )

        if capture_message_content:
            arguments = getattr(instance, "arguments", None)
            if arguments:
                try:
                    arg_str = (
                        json.dumps(arguments)
                        if not isinstance(arguments, str)
                        else arguments
                    )
                except (TypeError, ValueError):
                    arg_str = str(arguments)
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                    truncate_content(arg_str),
                )

        if response is not None:
            if hasattr(response, "status"):
                if (
                    response.status != "success"
                    and hasattr(response, "error")
                    and response.error
                ):
                    span.set_attribute(
                        SemanticConvention.ERROR_TYPE,
                        truncate_content(str(response.error)),
                    )
                    tool_errored = True
            if (
                capture_message_content
                and hasattr(response, "result")
                and response.result
            ):
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                    truncate_content(str(response.result)),
                )
    except Exception:
        pass
    return tool_errored


def _set_retrieval_attributes(span, instance, endpoint, args, kwargs):
    """Set attributes for vectordb/knowledge retrieval spans."""
    if not (endpoint.startswith("vectordb_") or endpoint.startswith("knowledge_")):
        return
    try:
        db_name = getattr(instance, "name", None) or type(instance).__name__
        span.set_attribute("gen_ai.data_source.id", str(db_name))
    except Exception:
        pass


def _set_memory_attributes(
    span, instance, endpoint, args, kwargs, capture_message_content
):
    """Set attributes for memory operation spans."""
    if not endpoint.startswith("memory_"):
        return
    try:
        op_type = endpoint.replace("memory_", "")
        span.set_attribute("gen_ai.agno.memory.operation", op_type)

        if hasattr(instance, "db") and instance.db:
            span.set_attribute("gen_ai.agno.memory.db_type", type(instance.db).__name__)

        if args and capture_message_content:
            span.set_attribute(
                "gen_ai.agno.memory.input",
                truncate_content(str(args[0])) if args[0] else "",
            )

        if "user_id" in kwargs:
            span.set_attribute(
                SemanticConvention.GEN_AI_REQUEST_USER, str(kwargs["user_id"])
            )
    except Exception:
        pass


def _get_function_description(fn):
    """Extract the best available description for an Agno Function object.

    Function.description is set lazily by process_entrypoint() (called during
    the first LLM interaction), so at create_agent time it is typically None.
    Fall back to inspect.getdoc on the actual entrypoint callable.
    """
    desc = getattr(fn, "description", None)
    if desc:
        return desc
    entrypoint = getattr(fn, "entrypoint", None)
    if callable(entrypoint):
        desc = inspect.getdoc(entrypoint)
        if desc:
            return desc
    return None


def _set_tool_definitions(span, tools):
    """Set gen_ai.tool.definitions from a list of Agno tool instances.

    For Agno toolkit objects (e.g. DuckDuckGoTools) that have a `functions`
    dict, we iterate the registered function names to avoid a mismatch
    between the toolkit class name and the actual function-level names
    used at execution time.
    """
    if not tools:
        return
    tool_defs = []
    for tool in tools[:10]:
        functions = getattr(tool, "functions", None)
        if isinstance(functions, dict) and functions:
            for fn_name, fn in functions.items():
                entry = {"type": "function", "name": str(fn_name)}
                desc = _get_function_description(fn)
                if desc:
                    entry["description"] = truncate_content(str(desc))
                tool_defs.append(entry)
        else:
            entry = {"type": "function"}
            name = getattr(tool, "name", None) or getattr(tool, "__name__", None)
            if name:
                entry["name"] = str(name)
            desc = _get_function_description(tool)
            if not desc:
                desc = getattr(tool, "__doc__", None)
            if desc:
                entry["description"] = truncate_content(str(desc))
            if len(entry) > 1:
                tool_defs.append(entry)
    if tool_defs:
        span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_DEFINITIONS, json.dumps(tool_defs)
        )


# ---------------------------------------------------------------------------
# Content capture (structured JSON format)
# ---------------------------------------------------------------------------
def _capture_content_as_attributes(span, instance, response, endpoint, args, kwargs):
    """Record input/output as span attributes in structured JSON format."""
    try:
        # Input messages
        input_content = None
        if endpoint.startswith("agent_") or endpoint.startswith("team_"):
            if args and args[0]:
                input_content = str(args[0])
            elif kwargs.get("input"):
                input_content = str(kwargs["input"])
            elif kwargs.get("input_message"):
                input_content = str(kwargs["input_message"])
            elif kwargs.get("message"):
                input_content = str(kwargs["message"])

        if input_content:
            span.set_attribute(
                SemanticConvention.GEN_AI_INPUT_MESSAGES,
                json.dumps([format_input_message("user", input_content)]),
            )

        # Output messages
        if response is not None:
            output_content = None
            if hasattr(response, "content") and response.content:
                output_content = str(response.content)
            elif hasattr(response, "message") and response.message:
                output_content = str(response.message)
            elif hasattr(response, "result") and response.result:
                output_content = str(response.result)
            elif isinstance(response, str):
                output_content = response

            if output_content:
                span.set_attribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    json.dumps([format_output_message(output_content)]),
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Metrics recording
# ---------------------------------------------------------------------------
def _record_agno_metrics(
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
            SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_AGNO,
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
# create_agent span emitter
# ---------------------------------------------------------------------------
def emit_create_agent_spans(
    tracer, instance, version, environment, application_name, capture_message_content
):
    """Emit a ``create_agent`` span for an Agent.__init__ call.

    Returns the SpanContext so the caller can store it on
    ``instance._openlit_creation_context`` for later span linking.
    """
    try:
        from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME, SERVICE_NAME
        from opentelemetry.semconv.resource import ResourceAttributes

        DEPLOYMENT_ENVIRONMENT = getattr(
            ResourceAttributes, "DEPLOYMENT_ENVIRONMENT", "deployment.environment"
        )
    except ImportError:
        TELEMETRY_SDK_NAME = "telemetry.sdk.name"
        SERVICE_NAME = "service.name"
        DEPLOYMENT_ENVIRONMENT = "deployment.environment"

    try:
        start_time = time.time()
        name = getattr(instance, "name", None) or "agent"
        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT} {name}"

        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
            span.set_attribute(
                SemanticConvention.GEN_AI_OPERATION,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_PROVIDER_NAME,
                SemanticConvention.GEN_AI_SYSTEM_AGNO,
            )
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))

            model_name = _extract_model_name(instance)
            if model_name:
                span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL, model_name)
                span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, model_name)

            agent_id = getattr(instance, "agent_id", None) or getattr(
                instance, "id", None
            )
            if not agent_id and name:
                agent_id = name.lower().replace(" ", "_")
            if agent_id:
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, str(agent_id))

            description = getattr(instance, "description", None)
            if description:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                    truncate_content(str(description)),
                )

            instructions = getattr(instance, "instructions", None)
            if instructions and capture_message_content:
                formatted = format_system_instructions(instructions)
                if formatted:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                        formatted,
                    )

            _set_tool_definitions(span, getattr(instance, "tools", None) or [])

            server_address, server_port = set_server_address_and_port(instance)
            if server_address:
                span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
            if server_port:
                span.set_attribute(SemanticConvention.SERVER_PORT, server_port)

            span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
            span.set_attribute(SERVICE_NAME, application_name)
            span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)
            span.set_attribute(
                SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                time.time() - start_time,
            )
            span.set_status(Status(StatusCode.OK))

            _apply_custom_span_attributes(span)

            return span.get_span_context()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Main response processor (replaces all process_*_request functions)
# ---------------------------------------------------------------------------
def process_agno_response(
    response,
    endpoint,
    span,
    instance,
    args,
    kwargs,
    start_time,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
):
    """Set OTel-compliant span attributes, capture content, and record metrics."""
    end_time = time.time()
    duration = end_time - start_time
    operation_type = OPERATION_MAP.get(
        endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_AGENT
    )

    # -- common framework attributes --
    scope = type("Scope", (), {})()
    scope._span = span
    scope._start_time = start_time
    scope._end_time = end_time

    request_model = _extract_model_name(instance)
    server_address, server_port = set_server_address_and_port(instance)

    class _ModelProxy:  # pylint: disable=too-few-public-methods
        def __init__(self, orig, model):
            self._original = orig
            self.model_name = model

        def __getattr__(self, name):
            return getattr(self._original, name)

    proxy = _ModelProxy(instance, request_model) if instance else None

    common_framework_span_attributes(
        scope,
        SemanticConvention.GEN_AI_SYSTEM_AGNO,
        server_address,
        server_port,
        environment,
        application_name,
        version,
        endpoint,
        proxy,
    )

    if request_model:
        span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, request_model)

    # Override raw endpoint with standard OTel operation name
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_type)

    # -- entity-specific attributes --
    _set_agent_attributes(span, instance, endpoint, capture_message_content)
    _set_team_attributes(span, instance, endpoint)
    _set_workflow_attributes(span, instance, endpoint)
    tool_errored = _set_tool_attributes(
        span, instance, endpoint, capture_message_content, args, kwargs, response
    )
    _set_retrieval_attributes(span, instance, endpoint, args, kwargs)
    _set_memory_attributes(
        span, instance, endpoint, args, kwargs, capture_message_content
    )

    # -- content capture as structured JSON --
    if capture_message_content:
        _capture_content_as_attributes(span, instance, response, endpoint, args, kwargs)

    # -- output type (not applicable for tool spans) --
    if operation_type != SemanticConvention.GEN_AI_OPERATION_TYPE_TOOLS:
        span.set_attribute(
            SemanticConvention.GEN_AI_OUTPUT_TYPE,
            SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
        )

    # -- token usage from RunOutput/TeamRunOutput --
    if response and (endpoint.startswith("agent_") or endpoint.startswith("team_")):
        input_tokens, output_tokens = _extract_token_usage(response)
        if input_tokens:
            span.set_attribute(
                SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, input_tokens
            )
        if output_tokens:
            span.set_attribute(
                SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens
            )

    # -- run_id from RunOutput --
    if response:
        run_id = getattr(response, "run_id", None)
        if run_id:
            span.set_attribute("gen_ai.response.id", str(run_id))

    # -- session/conversation from kwargs or parent contextvar --
    if kwargs:
        session_id = kwargs.get("session_id")
        if not session_id:
            session = kwargs.get("session")
            if session and hasattr(session, "session_id"):
                session_id = session.session_id
        if session_id:
            span.set_attribute(
                SemanticConvention.GEN_AI_CONVERSATION_ID, str(session_id)
            )

        user_id = kwargs.get("user_id")
        if user_id:
            span.set_attribute(SemanticConvention.GEN_AI_REQUEST_USER, str(user_id))

    if endpoint.startswith("tool_"):
        parent_agent = _agno_parent_agent.get()
        if parent_agent:
            parent_session_id = getattr(parent_agent, "session_id", None)
            if parent_session_id:
                span.set_attribute(
                    SemanticConvention.GEN_AI_CONVERSATION_ID,
                    str(parent_session_id),
                )

    # -- metrics --
    if not disable_metrics and metrics:
        _record_agno_metrics(
            metrics,
            operation_type,
            duration,
            environment,
            application_name,
            request_model,
            server_address,
            server_port,
        )

    if tool_errored:
        span.set_status(Status(StatusCode.ERROR, "Tool execution failed"))
    else:
        span.set_status(Status(StatusCode.OK))
    return response


# ---------------------------------------------------------------------------
# Version-compat target resolvers (kept as-is)
# ---------------------------------------------------------------------------
def resolve_agno_memory_target():
    """Resolve the appropriate Agno memory target class."""
    return resolve_target(
        "agno.memory",
        (
            ("agno.memory.v2.memory", "Memory"),
            ("agno.memory.manager", "MemoryManager"),
        ),
    )


def resolve_agno_knowledge_target():
    """Resolve the appropriate Agno knowledge target class."""
    return resolve_target(
        "agno.knowledge",
        (
            ("agno.knowledge.agent", "AgentKnowledge"),
            ("agno.knowledge.knowledge", "Knowledge"),
        ),
    )


def resolve_target(target_name, candidates):
    """Resolve a target class by trying multiple candidate modules."""
    for module_name, class_name in candidates:
        try:
            module = importlib.import_module(module_name)
            if hasattr(module, class_name):
                return module_name, class_name
        except ModuleNotFoundError:
            continue
        except Exception as e:
            logger.info("Skip %s candidate %s due to: %s", target_name, module_name, e)
            continue
    return None, None
