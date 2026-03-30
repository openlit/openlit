"""
OpenLIT Smolagents Instrumentation — OTel GenAI semantic convention compliant.

Targets smolagents (HuggingFace's lightweight agent framework).
Uses wrapt monkey-patching for agent runs, tool calls, and model invocations.
Dynamically discovers Model subclasses to wrap generate/generate_stream.
Patches ThreadPoolExecutor for correct context propagation in CodeAgent.
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.smolagents.smolagents import (
    general_wrap,
    model_generate_wrap,
    model_generate_stream_wrap,
)

_instruments = ("smolagents >= 1.0.0",)

# === ALWAYS-ON OPERATIONS ===
# Each tuple: (module, method, operation_key)
WORKFLOW_OPERATIONS = [
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
        self._wrapped_model_methods = []

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

        # -- Dynamic model wrapping --
        self._wrap_model_classes(*wrap_args)

        # -- ThreadPoolExecutor context propagation --
        self._install_context_propagation()

    def _wrap_model_classes(
        self,
        version,
        environment,
        application_name,
        tracer,
        pricing_info,
        capture_message_content,
        metrics,
        disable_metrics,
    ):
        """Dynamically discover all Model subclasses and wrap generate/generate_stream."""
        try:
            import smolagents
        except ImportError:
            return

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

        # Wrap generate() on the base Model class — all subclasses inherit
        try:
            wrap_function_wrapper(
                "smolagents.models",
                "Model.generate",
                model_generate_wrap(*wrap_args),
            )
            self._wrapped_model_methods.append(("smolagents.models", "Model.generate"))
        except Exception:
            pass

        # Wrap generate_stream() on the base Model class
        try:
            wrap_function_wrapper(
                "smolagents.models",
                "Model.generate_stream",
                model_generate_stream_wrap(*wrap_args),
            )
            self._wrapped_model_methods.append(
                ("smolagents.models", "Model.generate_stream")
            )
        except Exception:
            pass

        # Also wrap any subclass that overrides generate/generate_stream directly
        # to ensure interception even if the subclass doesn't call super()
        model_base = getattr(smolagents, "Model", None)
        if model_base is None:
            return

        seen = set()
        for attr_name in dir(smolagents):
            try:
                attr = getattr(smolagents, attr_name)
                if (
                    isinstance(attr, type)
                    and issubclass(attr, model_base)
                    and attr is not model_base
                    and attr.__name__ not in seen
                ):
                    seen.add(attr.__name__)
                    module = attr.__module__

                    # Only wrap if the subclass actually overrides the method
                    if "generate" in attr.__dict__:
                        try:
                            wrap_function_wrapper(
                                module,
                                f"{attr.__name__}.generate",
                                model_generate_wrap(*wrap_args),
                            )
                            self._wrapped_model_methods.append(
                                (module, f"{attr.__name__}.generate")
                            )
                        except Exception:
                            pass

                    if "generate_stream" in attr.__dict__:
                        try:
                            wrap_function_wrapper(
                                module,
                                f"{attr.__name__}.generate_stream",
                                model_generate_stream_wrap(*wrap_args),
                            )
                            self._wrapped_model_methods.append(
                                (module, f"{attr.__name__}.generate_stream")
                            )
                        except Exception:
                            pass
            except Exception:
                pass

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
        self._wrapped_model_methods.clear()
