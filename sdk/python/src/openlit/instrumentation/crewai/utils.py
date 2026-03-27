"""
CrewAI utilities for OTel GenAI semantic convention compliant telemetry.

Follows the same patterns as the LangGraph instrumentation (gold standard).
All operation names, span kinds, and attributes comply with the OTel GenAI
semantic conventions, particularly gen-ai-agent-spans.md which explicitly
names CrewAI as a framework that SHOULD report invoke_workflow for crews.
"""

import time
import json
import contextvars
from opentelemetry.trace import SpanKind, Status, StatusCode
from openlit.__helpers import (
    common_framework_span_attributes,
    get_server_address_for_provider,
    handle_exception,
    truncate_content,
)
from openlit.semcov import SemanticConvention

# ---------------------------------------------------------------------------
# Contextvars for span deduplication
# Prevents sync→async double-spanning (Crew.kickoff -> Crew.kickoff_async
# internally, and same for Flow).
# ---------------------------------------------------------------------------
_crewai_crew_active = contextvars.ContextVar(
    "openlit_crewai_crew_active", default=False
)
_crewai_flow_active = contextvars.ContextVar(
    "openlit_crewai_flow_active", default=False
)

# Propagates the executing agent's model info to child execute_tool spans
_current_agent_model_info = contextvars.ContextVar(
    "openlit_crewai_agent_model_info", default=None
)

# ---------------------------------------------------------------------------
# OTel GenAI Operation Mapping
# ---------------------------------------------------------------------------
OPERATION_MAP = {
    "crew_init": "create_agent",
    "crew_kickoff": "invoke_workflow",
    "crew_kickoff_async": "invoke_workflow",
    "crew_kickoff_for_each": "invoke_workflow",
    "crew_kickoff_for_each_async": "invoke_workflow",
    "task_execute_core": "invoke_agent",
    "agent_kickoff": "invoke_agent",
    "tool_run": "execute_tool",
    "flow_kickoff": "invoke_workflow",
    "flow_kickoff_async": "invoke_workflow",
    "flow_execute_method": "invoke_agent",
}

# ---------------------------------------------------------------------------
# SpanKind per operation type (OTel GenAI spec)
# ---------------------------------------------------------------------------
SPAN_KIND_MAP = {
    "invoke_workflow": SpanKind.INTERNAL,
    "invoke_agent": SpanKind.INTERNAL,
    "execute_tool": SpanKind.INTERNAL,
    "retrieval": SpanKind.CLIENT,
    "create_agent": SpanKind.CLIENT,
}


def get_span_kind(operation_type):
    """Return the correct SpanKind for *operation_type* per OTel GenAI spec."""
    return SPAN_KIND_MAP.get(operation_type, SpanKind.INTERNAL)


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
    """Map a model name string to a provider key in PROVIDER_DEFAULT_ENDPOINTS."""
    if not model_name:
        return None
    lower = model_name.lower()
    for prefix, provider in _MODEL_PREFIX_TO_PROVIDER.items():
        if lower.startswith(prefix):
            return provider
    return None


def set_server_address_and_port(instance):
    """Extract server address / port from a CrewAI instance's LLM config.

    Falls back to PROVIDER_DEFAULT_ENDPOINTS when no explicit api_base is set.
    For Tool instances, inherits from the parent agent via contextvar.
    """
    server_address = ""
    server_port = 0
    try:
        llm = getattr(instance, "llm", None)
        if not llm:
            agent = getattr(instance, "agent", None)
            if agent:
                llm = getattr(agent, "llm", None)

        # Crew instances: walk agents list
        if not llm:
            agents = getattr(instance, "agents", None)
            if agents:
                for ag in agents:
                    llm = getattr(ag, "llm", None)
                    if llm:
                        break

        if llm:
            api_base = getattr(llm, "api_base", None) or getattr(llm, "base_url", None)
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
    """Return (model_name, server_address, server_port) for a task's agent."""
    model_name = _extract_model_name(instance)
    server_address, server_port = set_server_address_and_port(instance)
    return (model_name, server_address, server_port)


def generate_span_name(endpoint, instance, args=None, kwargs=None):
    """Return an OTel-compliant span name: ``{operation} {entity_name}``."""
    operation = OPERATION_MAP.get(endpoint, "invoke_agent")

    if endpoint.startswith("crew_"):
        name = getattr(instance, "name", None) or "CrewAI"
        return f"{operation} {name}"

    if endpoint == "task_execute_core":
        agent = getattr(instance, "agent", None)
        role = getattr(agent, "role", None) if agent else None
        return f"{operation} {role or 'agent'}"

    if endpoint.startswith("agent_"):
        role = getattr(instance, "role", None) or "agent"
        return f"{operation} {role}"

    if endpoint == "tool_run":
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"{operation} {name}"

    if endpoint in ("flow_kickoff", "flow_kickoff_async"):
        name = getattr(instance, "name", None) or type(instance).__name__
        return f"{operation} {name}"

    if endpoint == "flow_execute_method":
        node_name = args[0] if args else "node"
        return f"{operation} {node_name}"

    return f"{operation} {endpoint}"


# ---------------------------------------------------------------------------
# Main response processor
# ---------------------------------------------------------------------------
def process_crewai_response(
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

    # -- common framework attributes (provider, model, server, duration …) --
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
        SemanticConvention.GEN_AI_SYSTEM_CREWAI,
        server_address,
        server_port,
        environment,
        application_name,
        version,
        endpoint,
        proxy,
    )

    # Override raw endpoint with standard OTel operation name
    standard_operation = OPERATION_MAP.get(endpoint, "invoke_agent")
    span.set_attribute(SemanticConvention.GEN_AI_OPERATION, standard_operation)

    # -- entity-specific attributes --
    _set_crew_attributes(span, instance, endpoint)
    _set_agent_attributes(span, instance, endpoint, capture_message_content)
    _set_task_attributes(span, instance, endpoint, capture_message_content)
    _set_tool_attributes(
        span, instance, endpoint, capture_message_content, args, kwargs, response
    )
    _set_flow_attributes(span, instance, endpoint)

    # -- content capture as span attributes (JSON), not legacy span events --
    if capture_message_content:
        _capture_content_as_attributes(span, instance, response, endpoint)

    # -- output type --
    span.set_attribute(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
    )

    # -- metrics --
    if not disable_metrics and metrics:
        _record_crewai_metrics(
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
# Internal helpers
# ---------------------------------------------------------------------------
def _extract_model_name(instance):
    """Walk the instance hierarchy to find the LLM model name."""
    if not instance:
        return "unknown"

    llm = getattr(instance, "llm", None)
    if not llm:
        agent = getattr(instance, "agent", None)
        if agent:
            llm = getattr(agent, "llm", None)

    # Crew instances: walk agents list to find first agent's LLM
    if not llm:
        agents = getattr(instance, "agents", None)
        if agents:
            for ag in agents:
                llm = getattr(ag, "llm", None)
                if llm:
                    break

    # Tool instances: inherit from parent agent via contextvar
    if not llm:
        model_info = _current_agent_model_info.get()
        if model_info:
            return model_info[0]

    if llm:
        name = (
            getattr(llm, "model_name", None)
            or getattr(llm, "model", None)
            or getattr(llm, "_model_name", None)
        )
        if name:
            return str(name)
    return "unknown"


def _set_crew_attributes(span, instance, endpoint):
    """Workflow attributes for Crew operations (OTel gen-ai-agent-spans)."""
    if not endpoint.startswith("crew_"):
        return
    try:
        crew_name = getattr(instance, "name", None) or "CrewAI"
        span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, crew_name)

        process = getattr(instance, "process", None)
        if process:
            span.set_attribute(
                SemanticConvention.GEN_AI_EXECUTION_MODE,
                getattr(process, "value", str(process)),
            )

        agents = getattr(instance, "agents", None) or []
        if agents:
            agent_defs = []
            for agent in agents[:10]:
                entry = {}
                role = getattr(agent, "role", None)
                if role:
                    entry["role"] = str(role)
                goal = getattr(agent, "goal", None)
                if goal:
                    entry["goal"] = str(goal)
                tools = getattr(agent, "tools", None) or []
                if tools:
                    entry["tools"] = [
                        getattr(t, "name", type(t).__name__) for t in tools[:5]
                    ]
                if entry:
                    agent_defs.append(entry)
            if agent_defs:
                span.set_attribute("gen_ai.crewai.crew.agents", json.dumps(agent_defs))

        tasks = getattr(instance, "tasks", None) or []
        if tasks:
            span.set_attribute("gen_ai.crewai.crew.task_count", len(tasks))
    except Exception:
        pass


def _set_agent_attributes(span, instance, endpoint, capture_message_content):
    """Agent attributes per OTel GenAI semantic conventions."""
    if not endpoint.startswith("agent_"):
        return
    try:
        agent_id = getattr(instance, "id", None)
        if agent_id:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, str(agent_id))

        agent_name = getattr(instance, "role", None) or getattr(instance, "name", None)
        if agent_name:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name))

        role = getattr(instance, "role", "")
        goal = getattr(instance, "goal", "")
        if role and goal:
            span.set_attribute(
                SemanticConvention.GEN_AI_AGENT_DESCRIPTION, f"{role}: {goal}"
            )
        elif goal:
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(goal))

        backstory = getattr(instance, "backstory", None)
        if backstory and capture_message_content:
            span.set_attribute(
                SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                truncate_content(str(backstory)),
            )

        _set_tool_definitions(span, getattr(instance, "tools", None) or [])
    except Exception:
        pass


def _set_task_attributes(span, instance, endpoint, capture_message_content):
    """Attributes for task execution (invoke_agent spans)."""
    if endpoint != "task_execute_core":
        return
    try:
        agent = getattr(instance, "agent", None)
        if agent:
            agent_name = getattr(agent, "role", None) or getattr(agent, "name", None)
            if agent_name:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_NAME, str(agent_name)
                )
            agent_id = getattr(agent, "id", None)
            if agent_id:
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, str(agent_id))

            role = getattr(agent, "role", "")
            goal = getattr(agent, "goal", "")
            if role and goal:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                    f"{role}: {goal}",
                )
            elif goal:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(goal)
                )

            backstory = getattr(agent, "backstory", None)
            if backstory and capture_message_content:
                span.set_attribute(
                    SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                    truncate_content(str(backstory)),
                )

            _set_tool_definitions(span, getattr(agent, "tools", None) or [])
    except Exception:
        pass


def _set_tool_attributes(
    span, instance, endpoint, capture_message_content, args, kwargs, response
):
    """Tool attributes per OTel GenAI semantic conventions."""
    if endpoint != "tool_run":
        return
    try:
        tool_name = getattr(instance, "name", None) or type(instance).__name__
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_NAME, str(tool_name))
        span.set_attribute(SemanticConvention.GEN_AI_TOOL_TYPE, "function")

        tool_desc = getattr(instance, "description", None)
        if tool_desc:
            span.set_attribute(
                SemanticConvention.GEN_AI_TOOL_DESCRIPTION,
                truncate_content(str(tool_desc)),
            )

        if capture_message_content:
            tool_input = None
            if args:
                try:
                    tool_input = (
                        json.dumps(args[0]) if len(args) == 1 else json.dumps(args)
                    )
                except (TypeError, ValueError):
                    tool_input = str(args)
            elif kwargs:
                try:
                    tool_input = json.dumps(kwargs)
                except (TypeError, ValueError):
                    tool_input = str(kwargs)
            if tool_input:
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_ARGUMENTS,
                    truncate_content(tool_input),
                )
            if response is not None:
                span.set_attribute(
                    SemanticConvention.GEN_AI_TOOL_CALL_RESULT,
                    truncate_content(str(response)),
                )
    except Exception:
        pass


def _set_flow_attributes(span, instance, endpoint):
    """Workflow / agent attributes for Flow operations."""
    if not endpoint.startswith("flow_"):
        return
    try:
        if endpoint in ("flow_kickoff", "flow_kickoff_async"):
            flow_name = getattr(instance, "name", None) or type(instance).__name__
            span.set_attribute(SemanticConvention.GEN_AI_WORKFLOW_NAME, str(flow_name))
        if endpoint == "flow_execute_method":
            node_name = getattr(instance, "_current_method_name", None)
            if node_name:
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(node_name))
    except Exception:
        pass


def _set_tool_definitions(span, tools):
    """Set gen_ai.tool.definitions from a list of CrewAI tool instances."""
    if not tools:
        return
    tool_defs = []
    for tool in tools[:10]:
        entry = {"type": "function"}
        name = getattr(tool, "name", None)
        if name:
            entry["name"] = str(name)
        desc = getattr(tool, "description", None)
        if desc:
            entry["description"] = truncate_content(str(desc))
        if len(entry) > 1:
            tool_defs.append(entry)
    if tool_defs:
        span.set_attribute(
            SemanticConvention.GEN_AI_TOOL_DEFINITIONS, json.dumps(tool_defs)
        )


def _capture_content_as_attributes(span, instance, response, endpoint):
    """Record input/output as span attributes (JSON), not legacy span events."""
    try:
        if endpoint == "task_execute_core":
            desc = getattr(instance, "description", None)
            if desc:
                span.set_attribute(
                    SemanticConvention.GEN_AI_INPUT_MESSAGES,
                    json.dumps(
                        [{"role": "user", "content": truncate_content(str(desc))}]
                    ),
                )

        if response is not None:
            output = truncate_content(str(response))
            if output:
                span.set_attribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                    json.dumps([{"role": "assistant", "content": output}]),
                )
    except Exception:
        pass


def emit_create_agent_spans(
    tracer,
    instance,
    version,
    environment,
    application_name,
    capture_message_content,
):
    """Emit a ``create_agent`` span per agent defined on a Crew instance.

    Returns a list of SpanContexts that the caller should store on
    ``instance._openlit_creation_contexts`` so the ``invoke_workflow``
    span created by ``Crew.kickoff`` can link back to them.
    """
    agents = getattr(instance, "agents", None) or []
    if not agents:
        return []

    creation_contexts = []
    for agent in agents:
        role = getattr(agent, "role", None) or "agent"
        span_name = f"create_agent {role}"
        with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
            span.set_attribute(
                SemanticConvention.GEN_AI_OPERATION,
                SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
            )
            span.set_attribute(
                SemanticConvention.GEN_AI_PROVIDER_NAME,
                SemanticConvention.GEN_AI_SYSTEM_CREWAI,
            )
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(role))

            agent_id = getattr(agent, "id", None)
            if agent_id:
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_ID, str(agent_id))

            goal = getattr(agent, "goal", "")
            if role and goal:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                    f"{role}: {goal}",
                )
            elif goal:
                span.set_attribute(
                    SemanticConvention.GEN_AI_AGENT_DESCRIPTION, str(goal)
                )

            backstory = getattr(agent, "backstory", None)
            if backstory and capture_message_content:
                span.set_attribute(
                    SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                    truncate_content(str(backstory)),
                )

            _set_tool_definitions(span, getattr(agent, "tools", None) or [])

            span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
            span.set_attribute(
                SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
            )
            span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION, version)
            span.set_status(Status(StatusCode.OK))

            creation_contexts.append(span.get_span_context())

    return creation_contexts


def _record_crewai_metrics(
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
            SemanticConvention.GEN_AI_PROVIDER_NAME: SemanticConvention.GEN_AI_SYSTEM_CREWAI,
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
