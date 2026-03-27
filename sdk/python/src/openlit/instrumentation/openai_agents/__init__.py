"""
OpenLIT OpenAI Agents Instrumentation
"""

import json
import threading
from typing import Collection
import importlib.metadata

from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from opentelemetry.trace import SpanKind
from wrapt import wrap_function_wrapper

from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvention
from openlit.instrumentation.openai_agents.processor import OpenLITTracingProcessor

_instruments = ("openai-agents >= 0.0.3",)


class _AgentCreationRegistry:
    """Thread-safe registry mapping agent name -> SpanContext from create_agent spans.

    Used to provide span links from invoke_agent back to create_agent,
    matching the pattern used in CrewAI and LangGraph instrumentations.
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


def _wrap_agent_init(
    tracer, environment, application_name, capture_message_content, registry
):
    """Return a wrapt wrapper for ``Agent.__init__`` that emits a
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
                    SemanticConvention.GEN_AI_SYSTEM_OPENAI,
                )
                span.set_attribute(SemanticConvention.GEN_AI_AGENT_NAME, str(name))

                model = getattr(instance, "model", None)
                if model:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_REQUEST_MODEL, str(model)
                    )

                instructions = getattr(instance, "instructions", None)
                if instructions and capture_message_content:
                    span.set_attribute(
                        SemanticConvention.GEN_AI_SYSTEM_INSTRUCTIONS,
                        str(instructions)[:4096],
                    )

                tools = getattr(instance, "tools", None)
                if tools:
                    tool_defs = []
                    for t in tools[:20]:
                        t_name = getattr(t, "name", None) or getattr(
                            t, "__name__", str(t)
                        )
                        tool_defs.append({"type": "function", "name": str(t_name)})
                    span.set_attribute(
                        SemanticConvention.GEN_AI_TOOL_DEFINITIONS,
                        json.dumps(tool_defs),
                    )

                handoffs = getattr(instance, "handoffs", None)
                if handoffs:
                    handoff_names = []
                    for h in handoffs[:20]:
                        h_name = getattr(h, "name", None) or str(h)
                        handoff_names.append(str(h_name))
                    span.set_attribute(
                        "gen_ai.agent.handoffs", json.dumps(handoff_names)
                    )

                span.set_attribute(SemanticConvention.GEN_AI_ENVIRONMENT, environment)
                span.set_attribute(
                    SemanticConvention.GEN_AI_APPLICATION_NAME, application_name
                )

                creation_ctx = span.get_span_context()
                instance._openlit_creation_context = creation_ctx
                registry.register(str(name), creation_ctx)
        except Exception as e:
            handle_exception(None, e)

        return result

    return wrapper


class OpenAIAgentsInstrumentor(BaseInstrumentor):
    """OpenLIT instrumentor for OpenAI Agents using native tracing system"""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("openai-agents")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        # Shared registry: create_agent span contexts keyed by agent name
        agent_registry = _AgentCreationRegistry()

        # Wrap Agent.__init__ to emit create_agent spans
        try:
            wrap_function_wrapper(
                "agents",
                "Agent.__init__",
                _wrap_agent_init(
                    tracer,
                    environment,
                    application_name,
                    capture_message_content,
                    agent_registry,
                ),
            )
        except Exception:
            pass

        # Create our processor with OpenLIT enhancements
        processor = OpenLITTracingProcessor(
            tracer=tracer,
            version=version,
            environment=environment,
            application_name=application_name,
            pricing_info=pricing_info,
            capture_message_content=capture_message_content,
            metrics=metrics,
            disable_metrics=disable_metrics,
            detailed_tracing=detailed_tracing,
            agent_creation_registry=agent_registry,
        )

        # Integrate with OpenAI Agents' native tracing system
        try:
            from agents import set_trace_processors

            set_trace_processors([processor])
        except ImportError:
            try:
                from agents import add_trace_processor

                add_trace_processor(processor)
            except ImportError:
                pass

    def _uninstrument(self, **kwargs):
        try:
            from agents import set_trace_processors

            set_trace_processors([])
        except ImportError:
            pass
