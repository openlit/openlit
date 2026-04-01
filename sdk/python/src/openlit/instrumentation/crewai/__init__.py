"""
OpenLIT CrewAI Instrumentation — OTel GenAI semantic convention compliant.

Targets CrewAI >= 1.10.0 (unified memory, Flow support).
All module paths verified against the actual CrewAI SDK.
"""

from typing import Collection
import importlib.metadata
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.crewai.crewai import general_wrap
from openlit.instrumentation.crewai.async_crewai import async_general_wrap

_instruments = ("crewai >= 1.10.0",)

# === ALWAYS-ON OPERATIONS ===
# Each tuple: (module, method, operation_key, sync_type)
WORKFLOW_OPERATIONS = [
    # Crew construction — create_agent spans
    ("crewai.crew", "Crew.__init__", "crew_init", "sync"),
    # Crew execution — invoke_workflow (OTel spec)
    ("crewai.crew", "Crew.kickoff", "crew_kickoff", "sync"),
    ("crewai.crew", "Crew.kickoff_async", "crew_kickoff_async", "async"),
    ("crewai.crew", "Crew.kickoff_for_each", "crew_kickoff_for_each", "sync"),
    (
        "crewai.crew",
        "Crew.kickoff_for_each_async",
        "crew_kickoff_for_each_async",
        "async",
    ),
    # Task execution — invoke_agent
    ("crewai.task", "Task._execute_core", "task_execute_core", "sync"),
    # Tool execution — execute_tool (corrected module path)
    ("crewai.tools.base_tool", "BaseTool.run", "tool_run", "sync"),
    # Flow execution — invoke_workflow
    ("crewai.flow.flow", "Flow.kickoff", "flow_kickoff", "sync"),
    ("crewai.flow.flow", "Flow.kickoff_async", "flow_kickoff_async", "async"),
]

# === DETAILED-TRACING OPERATIONS ===
DETAILED_OPERATIONS = [
    # Agent standalone kickoff — invoke_agent
    ("crewai", "Agent.kickoff", "agent_kickoff", "sync"),
    # Flow node execution — invoke_agent
    ("crewai.flow.flow", "Flow._execute_method", "flow_execute_method", "sync"),
]


class _ContextPropagatingDescriptor:  # pylint: disable=too-few-public-methods
    """Propagate OTel context from the calling thread into CrewAI's
    ThreadPoolExecutor so that child spans (tool, task) are properly
    parented under the agent / workflow span.

    ``Agent._execute_without_timeout`` is resolved via ``__get__`` in the
    *main* thread (which holds the correct OTel context) before being
    submitted to the thread pool.  The returned closure re-attaches that
    context in the *worker* thread.
    """

    def __init__(self, original):
        self._original = original
        self._name = None

    def __set_name__(self, owner, name):
        self._name = name

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        from opentelemetry import context as context_api

        bound = self._original.__get__(obj, objtype)
        ctx = context_api.get_current()

        def _propagating_wrapper(*args, **kwargs):
            token = context_api.attach(ctx)
            try:
                return bound(*args, **kwargs)
            finally:
                context_api.detach(token)

        return _propagating_wrapper


class CrewAIInstrumentor(BaseInstrumentor):
    """OTel GenAI semantic convention compliant instrumentor for CrewAI."""

    def __init__(self):
        super().__init__()
        self._original_execute_without_timeout = None

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("crewai")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = OpenlitConfig.metrics_dict
        disable_metrics = kwargs.get("disable_metrics")
        wrap_args = (
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )

        # -- always-on operations --
        for module, method, op_key, sync_type in WORKFLOW_OPERATIONS:
            try:
                if sync_type == "async":
                    wrapper = async_general_wrap(op_key, *wrap_args)
                else:
                    wrapper = general_wrap(op_key, *wrap_args)
                wrap_function_wrapper(module, method, wrapper)
            except Exception:
                pass

        # -- detailed-tracing operations --
        for module, method, op_key, sync_type in DETAILED_OPERATIONS:
            try:
                if sync_type == "async":
                    wrapper = async_general_wrap(op_key, *wrap_args)
                else:
                    wrapper = general_wrap(op_key, *wrap_args)
                wrap_function_wrapper(module, method, wrapper)
            except Exception:
                pass

        # -- thread context propagation --
        self._install_context_propagation()

    def _install_context_propagation(self):
        """Replace ``Agent._execute_without_timeout`` with a descriptor that
        propagates OTel context across CrewAI's thread-pool boundary."""
        try:
            import crewai.agent.core as _agent_core

            original = getattr(_agent_core.Agent, "_execute_without_timeout", None)
            if original is not None and not isinstance(
                original, _ContextPropagatingDescriptor
            ):
                self._original_execute_without_timeout = original
                _agent_core.Agent._execute_without_timeout = (
                    _ContextPropagatingDescriptor(original)
                )
        except Exception:
            pass

    def _uninstrument(self, **kwargs):
        """Best-effort restoration of the context-propagation descriptor."""
        try:
            import crewai.agent.core as _agent_core

            original = getattr(self, "_original_execute_without_timeout", None)
            if original is not None:
                _agent_core.Agent._execute_without_timeout = original
        except Exception:
            pass
