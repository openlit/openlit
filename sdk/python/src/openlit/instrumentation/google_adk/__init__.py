"""
OpenLIT Google ADK Instrumentation — OTel GenAI semantic convention compliant.

Provides auto-instrumentation for Google ADK (Agent Development Kit) including:
- Agent construction (LlmAgent.__init__  -> create_agent spans)
- Runner execution  (Runner.run_async, Runner.run  -> invoke_workflow spans)
- Agent execution   (BaseAgent.run_async  -> invoke_agent spans)
- LLM call enrichment  (trace_call_llm  -> OTel semconv attributes on ADK spans)
- Tool call enrichment (trace_tool_call  -> OTel semconv attributes on ADK spans)

Uses a selective _PassthroughTracer strategy:
- Replaces ADK's runners.tracer and base_agent.tracer to suppress their spans
  (OpenLIT creates invoke_workflow / invoke_agent instead).
- Leaves ADK's telemetry.tracing.tracer intact so call_llm, generate_content,
  and execute_tool spans remain as children, enriched with OTel attributes via
  decorator-style wrappers on ADK's trace_call_llm / trace_tool_call functions.
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
from openlit.instrumentation.google_adk.utils import (
    _PassthroughTracer,
    _resolve_model_string,
    enrich_llm_span,
    enrich_tool_span,
    enrich_merged_tool_span,
)

_instruments = ("google-adk >= 1.2.0",)

# Always-on wrapping operations
# (module, method, endpoint_key, sync_type)
WORKFLOW_OPERATIONS = [
    ("google.adk.agents.llm_agent", "LlmAgent.__init__", "agent_init", "sync"),
    ("google.adk.runners", "Runner.run_async", "runner_run_async", "async"),
    ("google.adk.runners", "Runner.run", "runner_run", "sync"),
    ("google.adk.agents.base_agent", "BaseAgent.run_async", "agent_run_async", "async"),
]

DETAILED_OPERATIONS = [
    ("google.adk.runners", "Runner.run_live", "runner_run_live", "async"),
]


class _AgentCreationRegistry:
    """Thread-safe registry mapping agent name -> SpanContext from create_agent spans.

    Used to provide span links from invoke_agent / invoke_workflow
    back to create_agent, matching the pattern used in CrewAI and
    OpenAI Agents instrumentations.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._contexts: dict = {}

    def register(self, agent_name, span_context):
        with self._lock:
            self._contexts[agent_name] = span_context

    def get(self, agent_name):
        with self._lock:
            return self._contexts.get(agent_name)

    def get_all(self):
        with self._lock:
            return list(self._contexts.values())


def _wrap_agent_init(
    tracer, environment, application_name, capture_message_content, registry
):
    """Return a wrapt wrapper for ``LlmAgent.__init__`` that emits a
    ``create_agent`` span per agent construction."""

    def wrapper(wrapped, instance, args, kwargs):
        result = wrapped(*args, **kwargs)

        try:
            name = getattr(instance, "name", None) or "agent"
            span_name = f"create_agent {name}"

            with tracer.start_as_current_span(span_name, kind=SpanKind.CLIENT) as span:
                span.set_attribute(
                    SemanticConvention.GEN_AI_OPERATION,
                    SemanticConvention.GEN_AI_OPERATION_TYPE_CREATE_AGENT,
                )
                span.set_attribute(
                    SemanticConvention.GEN_AI_PROVIDER_NAME,
                    SemanticConvention.GEN_AI_SYSTEM_GOOGLE_ADK,
                )
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))

                description = getattr(instance, "description", None)
                if description:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_AGENT_DESCRIPTION,
                        str(description),
                    )

                model = getattr(instance, "model", None)
                if model:
                    model_str = _resolve_model_string(model) or str(model)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_REQUEST_MODEL, model_str
                    )

                instruction = getattr(instance, "instruction", None)
                if instruction and capture_message_content:
                    instr_str = str(instruction)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                        truncate_content(instr_str),
                    )

                tools = getattr(instance, "tools", None)
                if tools:
                    tool_defs = []
                    for t in tools[:20]:
                        t_name = (
                            getattr(t, "name", None)
                            or getattr(t, "__name__", None)
                            or type(t).__name__
                        )
                        entry = {"type": "function", "name": str(t_name)}
                        t_desc = getattr(t, "description", None) or getattr(
                            t, "__doc__", None
                        )
                        if t_desc:
                            entry["description"] = truncate_content(str(t_desc))
                        tool_defs.append(entry)
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_DEFINITIONS,
                        json.dumps(tool_defs),
                    )

                sub_agents = getattr(instance, "sub_agents", None)
                if sub_agents:
                    handoff_names = [
                        str(getattr(sa, "name", "unknown")) for sa in sub_agents[:20]
                    ]
                    span.set_attribute(
                        "gen_ai.agent.handoffs", json.dumps(handoff_names)
                    )

                span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
                span.set_attribute(
                    SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
                )
                span.set_status(Status(StatusCode.OK))

                creation_ctx = span.get_span_context()
                instance._openlit_creation_context = creation_ctx
                registry.register(str(name), creation_ctx)
        except Exception:
            pass

        return result

    return wrapper


def _disable_existing_tracers():
    """Replace ADK's internal tracers with ``_PassthroughTracer`` to suppress
    duplicate spans for operations that OpenLIT controls.

    Returns a dict of original tracers for restoration in ``_uninstrument()``.
    """
    originals = {}

    try:
        import google.adk.runners as runners_mod

        originals["runners.tracer"] = getattr(runners_mod, "tracer", None)
        if originals["runners.tracer"] is not None:
            runners_mod.tracer = _PassthroughTracer(originals["runners.tracer"])
    except Exception:
        pass

    try:
        import google.adk.agents.base_agent as base_agent_mod

        originals["base_agent.tracer"] = getattr(base_agent_mod, "tracer", None)
        if originals["base_agent.tracer"] is not None:
            base_agent_mod.tracer = _PassthroughTracer(originals["base_agent.tracer"])
    except Exception:
        pass

    return originals


def _wrap_trace_call_llm(capture_message_content):
    """Create and install a decorator wrapper around ADK's ``trace_call_llm``
    that enriches the current span with OTel GenAI semconv attributes.

    Returns the original function for restoration.
    """
    original = None
    try:
        import google.adk.flows.llm_flows.base_llm_flow as blf_mod

        original_fn = getattr(blf_mod, "trace_call_llm", None)
        if original_fn is None:
            return None

        original = original_fn

        def enriched_trace_call_llm(*args, **kwargs):
            # ADK signature: trace_call_llm(invocation_context, event_id, llm_request, llm_response, span=None)
            result = original_fn(*args, **kwargs)
            try:
                from opentelemetry import trace as trace_api

                span = trace_api.get_current_span()
                llm_request = args[2] if len(args) > 2 else kwargs.get("llm_request")
                llm_response = args[3] if len(args) > 3 else kwargs.get("llm_response")
                enrich_llm_span(
                    span, llm_request, llm_response, capture_message_content
                )
            except Exception:
                pass
            return result

        blf_mod.trace_call_llm = enriched_trace_call_llm
    except Exception:
        pass

    return original


def _wrap_trace_tool_call(capture_message_content):
    """Create and install a decorator wrapper around ADK's ``trace_tool_call``
    that enriches the current span with OTel GenAI semconv attributes.

    Returns the original function for restoration.
    """
    original = None
    try:
        import google.adk.flows.llm_flows.functions as functions_mod

        original_fn = getattr(functions_mod, "trace_tool_call", None)
        if original_fn is None:
            return None

        original = original_fn

        def enriched_trace_tool_call(*args, **kwargs):
            # ADK signature: trace_tool_call(tool, args, function_response_event, error=None)
            result = original_fn(*args, **kwargs)
            try:
                from opentelemetry import trace as trace_api

                span = trace_api.get_current_span()
                tool = args[0] if len(args) > 0 else kwargs.get("tool")
                function_args = args[1] if len(args) > 1 else kwargs.get("args")
                function_response_event = (
                    args[2] if len(args) > 2 else kwargs.get("function_response_event")
                )
                enrich_tool_span(
                    span,
                    tool,
                    function_args,
                    function_response_event,
                    capture_message_content,
                )
            except Exception:
                pass
            return result

        functions_mod.trace_tool_call = enriched_trace_tool_call
    except Exception:
        pass

    return original


def _wrap_trace_merged_tool_calls(capture_message_content):
    """Create and install a decorator wrapper around ADK's ``trace_merged_tool_calls``
    that enriches the current span with OTel GenAI semconv attributes.

    Returns the original function for restoration.
    """
    original = None
    try:
        import google.adk.flows.llm_flows.functions as functions_mod

        original_fn = getattr(functions_mod, "trace_merged_tool_calls", None)
        if original_fn is None:
            return None

        original = original_fn

        def enriched_trace_merged(*args, **kwargs):
            # ADK signature: trace_merged_tool_calls(response_event_id, function_response_event)
            result = original_fn(*args, **kwargs)
            try:
                from opentelemetry import trace as trace_api

                span = trace_api.get_current_span()
                response_event_id = (
                    args[0] if len(args) > 0 else kwargs.get("response_event_id")
                )
                function_response_event = (
                    args[1] if len(args) > 1 else kwargs.get("function_response_event")
                )
                enrich_merged_tool_span(
                    span,
                    response_event_id,
                    function_response_event,
                    capture_message_content,
                )
            except Exception:
                pass
            return result

        functions_mod.trace_merged_tool_calls = enriched_trace_merged
    except Exception:
        pass

    return original


class GoogleADKInstrumentor(BaseInstrumentor):
    """OTel GenAI semantic convention compliant instrumentor for Google ADK."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("google-adk")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        agent_registry = _AgentCreationRegistry()

        self._original_tracers = _disable_existing_tracers()

        self._original_trace_call_llm = _wrap_trace_call_llm(capture_message_content)
        self._original_trace_tool_call = _wrap_trace_tool_call(capture_message_content)
        self._original_trace_merged = _wrap_trace_merged_tool_calls(
            capture_message_content
        )

        from openlit.instrumentation.google_adk.async_google_adk import (
            async_runner_wrap,
            async_agent_wrap,
        )
        from openlit.instrumentation.google_adk.google_adk import sync_runner_wrap

        for module, method, op_key, sync_type in WORKFLOW_OPERATIONS:
            try:
                if op_key == "agent_init":
                    wrapper = _wrap_agent_init(
                        tracer,
                        environment,
                        application_name,
                        capture_message_content,
                        agent_registry,
                    )
                elif op_key == "runner_run":
                    wrapper = sync_runner_wrap(
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
                elif op_key == "runner_run_async":
                    wrapper = async_runner_wrap(
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
                elif op_key == "agent_run_async":
                    wrapper = async_agent_wrap(
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
            for module, method, op_key, sync_type in DETAILED_OPERATIONS:
                try:
                    wrapper = async_runner_wrap(
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
                    wrap_function_wrapper(module, method, wrapper)
                except Exception:
                    pass

    def _uninstrument(self, **kwargs):
        """Restore original ADK tracers and tracing functions."""
        originals = getattr(self, "_original_tracers", {})

        try:
            if (
                "runners.tracer" in originals
                and originals["runners.tracer"] is not None
            ):
                import google.adk.runners as runners_mod

                runners_mod.tracer = originals["runners.tracer"]
        except Exception:
            pass

        try:
            if (
                "base_agent.tracer" in originals
                and originals["base_agent.tracer"] is not None
            ):
                import google.adk.agents.base_agent as base_agent_mod

                base_agent_mod.tracer = originals["base_agent.tracer"]
        except Exception:
            pass

        try:
            original_fn = getattr(self, "_original_trace_call_llm", None)
            if original_fn is not None:
                import google.adk.flows.llm_flows.base_llm_flow as blf_mod

                blf_mod.trace_call_llm = original_fn
        except Exception:
            pass

        try:
            original_fn = getattr(self, "_original_trace_tool_call", None)
            if original_fn is not None:
                import google.adk.flows.llm_flows.functions as functions_mod

                functions_mod.trace_tool_call = original_fn
        except Exception:
            pass

        try:
            original_fn = getattr(self, "_original_trace_merged", None)
            if original_fn is not None:
                import google.adk.flows.llm_flows.functions as functions_mod

                functions_mod.trace_merged_tool_calls = original_fn
        except Exception:
            pass
