"""
OpenLIT Smolagents Instrumentation — OTel GenAI semantic convention compliant.

Targets smolagents (HuggingFace's lightweight agent framework).
Uses wrapt monkey-patching for agent runs and tool calls.
LLM call spans are delegated to the underlying SDK instrumentors (OpenAI, etc.).
Patches ThreadPoolExecutor for correct context propagation in CodeAgent.
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.smolagents.smolagents import general_wrap

_instruments = ("smolagents >= 1.0.0",)

# === ALWAYS-ON OPERATIONS ===
# Each tuple: (module, method, operation_key)
WORKFLOW_OPERATIONS = [
    ("smolagents.agents", "MultiStepAgent.__init__", "agent_init"),
    ("smolagents.agents", "MultiStepAgent.run", "agent_run"),
    ("smolagents.agents", "ToolCallingAgent.execute_tool_call", "execute_tool_call"),
    ("smolagents.tools", "Tool.__call__", "tool_call"),
]

# === DETAILED-TRACING OPERATIONS ===
DETAILED_OPERATIONS = [
    ("smolagents.agents", "CodeAgent._step_stream", "code_step"),
    ("smolagents.agents", "ToolCallingAgent._step_stream", "tool_calling_step"),
    ("smolagents.agents", "MultiStepAgent._generate_planning_step", "planning_step"),
    ("smolagents.agents", "MultiStepAgent.__call__", "managed_agent_call"),
]


class SmolAgentsInstrumentor(BaseInstrumentor):
    """OTel GenAI semantic convention compliant instrumentor for smolagents."""

    def __init__(self):
        super().__init__()
        self._original_executor_class = None

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        try:
            version = importlib.metadata.version("smolagents")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"

        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

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

        # -- Always-on operations --
        for module, method, op_key in WORKFLOW_OPERATIONS:
            try:
                wrapper = general_wrap(op_key, *wrap_args)
                wrap_function_wrapper(module, method, wrapper)
            except Exception:
                pass

        # -- Detailed-tracing operations --
        if detailed_tracing:
            for module, method, op_key in DETAILED_OPERATIONS:
                try:
                    wrapper = general_wrap(op_key, *wrap_args)
                    wrap_function_wrapper(module, method, wrapper)
                except Exception:
                    pass

        # -- ThreadPoolExecutor context propagation --
        self._install_context_propagation()

    def _install_context_propagation(self):
        """Patch ThreadPoolExecutor in smolagents to propagate contextvars.

        CodeAgent and ToolCallingAgent use ThreadPoolExecutor for parallel
        tool calls. Without this patch, child spans in worker threads lose
        their parent context.
        """
        try:
            import smolagents.local_python_executor as executor_module
            from concurrent.futures import ThreadPoolExecutor
            import contextvars

            original_cls = getattr(executor_module, "ThreadPoolExecutor", None)
            if original_cls is None:
                # Module may not use ThreadPoolExecutor directly; check agents
                try:
                    import smolagents.agents as agents_module

                    original_cls = getattr(agents_module, "ThreadPoolExecutor", None)
                    if original_cls and original_cls is not ThreadPoolExecutor:
                        return
                    executor_module = agents_module
                except Exception:
                    return

            if original_cls is None:
                return

            if getattr(original_cls, "_openlit_patched", False):
                return

            self._original_executor_class = (executor_module, original_cls)

            class _ContextAwareThreadPoolExecutor(ThreadPoolExecutor):
                """ThreadPoolExecutor that copies contextvars into workers."""

                _openlit_patched = True

                def submit(self, fn, /, *args, **kwargs):
                    ctx = contextvars.copy_context()
                    return super().submit(ctx.run, fn, *args, **kwargs)

            executor_module.ThreadPoolExecutor = _ContextAwareThreadPoolExecutor
        except Exception:
            pass

    def _uninstrument(self, **kwargs):
        """Best-effort restoration."""
        if self._original_executor_class is not None:
            try:
                module, cls = self._original_executor_class
                module.ThreadPoolExecutor = cls
            except Exception:
                pass
            self._original_executor_class = None
