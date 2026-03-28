"""
OpenLIT Microsoft Agent Framework Instrumentation — OTel GenAI semantic
convention compliant.

Provides auto-instrumentation for Microsoft Agent Framework including:
- Agent execution   (Agent.run            -> invoke_agent spans)
- Tool execution    (FunctionTool.invoke  -> execute_tool spans)
- Agent construction (Agent.__init__      -> create_agent spans, detailed_tracing only)
- Workflow execution (Workflow.run        -> invoke_workflow spans, detailed_tracing only)

Disables AF's built-in telemetry (AgentTelemetryLayer / ChatTelemetryLayer)
via the global OBSERVABILITY_SETTINGS singleton to avoid duplicate spans, then
replaces them with OpenLIT-enriched OTel GenAI semconv-compliant spans.
"""

import json
import threading
from typing import Collection
import importlib.metadata

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.trace import SpanKind, Status, StatusCode
from wrapt import wrap_function_wrapper

from openlit.__helpers import handle_exception, truncate_content
from openlit.semcov import SemanticConvention

_instruments = ("agent-framework >= 1.0.0rc1",)

WORKFLOW_OPERATIONS = [
    ("agent_framework", "Agent.run", "agent_run", "agent_run"),
    ("agent_framework._tools", "FunctionTool.invoke", "tool_execute", "async"),
]

DETAILED_OPERATIONS = [
    ("agent_framework", "Agent.__init__", "agent_init", "sync"),
    ("agent_framework._workflows._workflow", "Workflow.run", "workflow_run", "async"),
]


class _AgentCreationRegistry:
    """Thread-safe registry mapping agent name -> SpanContext from create_agent spans.

    Used to provide span links from invoke_agent back to create_agent,
    matching the pattern used in CrewAI, Google ADK, and OpenAI Agents
    instrumentations.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._contexts: dict = {}

    def register(self, agent_name, span_context):
        """Store the span context for a given agent name."""
        with self._lock:
            self._contexts[agent_name] = span_context

    def get(self, agent_name):
        """Retrieve the span context for a given agent name, or ``None``."""
        with self._lock:
            return self._contexts.get(agent_name)

    def get_all(self):
        """Return all registered span contexts."""
        with self._lock:
            return list(self._contexts.values())


def _wrap_agent_init(
    tracer, environment, application_name, capture_message_content, registry
):
    """Return a wrapt wrapper for ``Agent.__init__`` that emits a
    ``create_agent`` span per agent construction."""

    def wrapper(wrapped, instance, args, kwargs):
        result = wrapped(*args, **kwargs)

        try:
            name = (
                getattr(instance, "name", None)
                or getattr(instance, "id", None)
                or "agent"
            )
            span_name = f"create_agent {name}"

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                span.set_attribute(
                    SemanticConvention.GEN_AI_OPERATION,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                )
                span.set_attribute(
                    SemanticConvention.GEN_AI_PROVIDER_NAME,
                    SemanticConvention.GEN_AI_SYSTEM_AGENT_FRAMEWORK,
                )
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))

                agent_id = getattr(instance, "id", None)
                if agent_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_AGENT_ID, str(agent_id)
                    )

                description = getattr(instance, "description", None)
                if description:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                        str(description),
                    )

                model_id = getattr(instance, "model_id", None)
                if not model_id:
                    chat_client = getattr(instance, "chat_client", None)
                    if chat_client:
                        model_id = getattr(chat_client, "model_id", None)
                if model_id:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_REQUEST_MODEL, str(model_id)
                    )

                instructions = getattr(instance, "instructions", None)
                if instructions and capture_message_content:
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

                tools = getattr(instance, "tools", None)
                if tools:
                    tool_defs = []
                    for t in (tools if not hasattr(tools, "__iter__") else list(tools))[
                        :20
                    ]:
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
                            SemanticConvention.GEN_AI_TOOL_DEFINITIONS,
                            json.dumps(tool_defs),
                        )

                span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
                span.set_attribute(
                    SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
                )
                span.set_status(Status(StatusCode.OK))

                creation_ctx = span.get_span_context()
                instance._openlit_creation_context = creation_ctx
                registry.register(str(name), creation_ctx)
        except Exception as e:
            handle_exception(span, e)

        return result

    return wrapper


def _disable_af_telemetry():
    """Disable Agent Framework's built-in OpenTelemetry instrumentation.

    AF uses a global ``OBSERVABILITY_SETTINGS`` singleton that gates all
    telemetry.  Setting ``enable_instrumentation = False`` causes
    ``AgentTelemetryLayer.run()`` and ``ChatTelemetryLayer.get_response()``
    to pass through directly to the underlying methods with zero overhead.

    Returns the previous value so it can be restored in _uninstrument().
    """
    try:
        from agent_framework.observability import OBSERVABILITY_SETTINGS

        previous = OBSERVABILITY_SETTINGS.enable_instrumentation
        OBSERVABILITY_SETTINGS.enable_instrumentation = False
        return previous
    except Exception:
        return None


def _restore_af_telemetry(previous_value):
    """Restore AF's built-in telemetry setting."""
    if previous_value is None:
        return
    try:
        from agent_framework.observability import OBSERVABILITY_SETTINGS

        OBSERVABILITY_SETTINGS.enable_instrumentation = previous_value
    except Exception:
        pass


class AgentFrameworkInstrumentor(BaseInstrumentor):
    """OTel GenAI semantic convention compliant instrumentor for
    Microsoft Agent Framework."""

    def __init__(self):
        super().__init__()
        self._previous_af_telemetry = None

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("agent-framework")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        agent_registry = _AgentCreationRegistry()

        self._previous_af_telemetry = _disable_af_telemetry()

        from openlit.instrumentation.agent_framework.async_agent_framework import (
            agent_run_wrap,
            tool_execute_wrap,
            workflow_run_wrap,
        )

        for module, method, op_key, _sync_type in WORKFLOW_OPERATIONS:
            try:
                if op_key == "agent_run":
                    wrapper = agent_run_wrap(
                        op_key,
                        version,
                        environment,
                        application_name,
                        tracer,
                        pricing_info,
                        capture_message_content,
                        metrics,
                        disable_metrics,
                        agent_registry,
                    )
                elif op_key == "tool_execute":
                    wrapper = tool_execute_wrap(
                        op_key,
                        version,
                        environment,
                        application_name,
                        tracer,
                        pricing_info,
                        capture_message_content,
                        metrics,
                        disable_metrics,
                        agent_registry,
                    )
                else:
                    continue

                wrap_function_wrapper(module, method, wrapper)
            except Exception:
                pass

        if detailed_tracing:
            for module, method, op_key, _sync_type in DETAILED_OPERATIONS:
                try:
                    if op_key == "agent_init":
                        wrapper = _wrap_agent_init(
                            tracer,
                            environment,
                            application_name,
                            capture_message_content,
                            agent_registry,
                        )
                    elif op_key == "workflow_run":
                        wrapper = workflow_run_wrap(
                            op_key,
                            version,
                            environment,
                            application_name,
                            tracer,
                            pricing_info,
                            capture_message_content,
                            metrics,
                            disable_metrics,
                            agent_registry,
                        )
                    else:
                        continue

                    wrap_function_wrapper(module, method, wrapper)
                except Exception:
                    pass

    def _uninstrument(self, **kwargs):
        """Restore AF's built-in telemetry."""
        _restore_af_telemetry(self._previous_af_telemetry)
