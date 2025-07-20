# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of mem0 Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.mem0.mem0 import mem0_wrap

_instruments = ("mem0ai >= 0.1.32",)

# Optimized method configuration following OpenLIT Framework Guide principles
# Using tuples for better memory efficiency and performance
WRAPPED_METHODS = [
    # Memory initialization - creates parent span for init operations
    {
        "package": "mem0",
        "object": "Memory.__init__",
        "endpoint": "memory init", 
        "wrapper": mem0_wrap,
        "priority": "critical",
    },
    # Sync Memory methods (Top-level operations)
    {
        "package": "mem0",
        "object": "Memory.add",
        "endpoint": "memory add",
        "wrapper": mem0_wrap,
        "priority": "high",  # Core memory operation
    },
    {
        "package": "mem0",
        "object": "Memory.get_all",
        "endpoint": "memory get_all",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.get",
        "endpoint": "memory get",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.search",
        "endpoint": "memory search",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.update",
        "endpoint": "memory update",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.delete",
        "endpoint": "memory delete",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.delete_all",
        "endpoint": "memory delete_all",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.history",
        "endpoint": "memory history",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.reset",
        "endpoint": "memory reset",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.chat",
        "endpoint": "memory chat",
        "wrapper": mem0_wrap,
    },
    # Enhanced tracing: Internal operations (when detailed_tracing=True)
    # These provide superior hierarchy vs competitors
    {
        "package": "mem0.memory.main",
        "object": "Memory._add_to_vector_store",
        "endpoint": "memory add_to_vector_store",
        "wrapper": mem0_wrap,
        "priority": "medium",  # Internal operation
    },
    {
        "package": "mem0.memory.main",
        "object": "Memory._add_to_graph",
        "endpoint": "memory add_to_graph",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "Memory._search_vector_store",
        "endpoint": "memory search_vector_store",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "Memory._get_all_from_vector_store",
        "endpoint": "memory get_all_from_vector_store",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "Memory._create_memory",
        "endpoint": "memory create_memory",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "Memory._update_memory",
        "endpoint": "memory update_memory",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "Memory._delete_memory",
        "endpoint": "memory delete_memory",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "Memory._create_procedural_memory",
        "endpoint": "memory create_procedural_memory",
        "wrapper": mem0_wrap,
    },
    # Async Memory methods (Top-level operations)
    {
        "package": "mem0",
        "object": "AsyncMemory.__init__",
        "endpoint": "memory init",
        "wrapper": mem0_wrap,
        "priority": "critical",
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.add",
        "endpoint": "memory add",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.get_all",
        "endpoint": "memory get_all",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.get",
        "endpoint": "memory get",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.search",
        "endpoint": "memory search",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.update",
        "endpoint": "memory update",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.delete",
        "endpoint": "memory delete",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.delete_all",
        "endpoint": "memory delete_all",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.history",
        "endpoint": "memory history",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.reset",
        "endpoint": "memory reset",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "AsyncMemory.chat",
        "endpoint": "memory chat",
        "wrapper": mem0_wrap,
    },
    # Async detailed tracing: Internal operations
    {
        "package": "mem0.memory.main",
        "object": "AsyncMemory._add_to_graph",
        "endpoint": "memory add_to_graph",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "AsyncMemory._get_all_from_vector_store",
        "endpoint": "memory get_all_from_vector_store",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "AsyncMemory._search_vector_store",
        "endpoint": "memory search_vector_store",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "AsyncMemory._create_memory",
        "endpoint": "memory create_memory",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "AsyncMemory._update_memory",
        "endpoint": "memory update_memory",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "AsyncMemory._delete_memory",
        "endpoint": "memory delete_memory",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0.memory.main",
        "object": "AsyncMemory._create_procedural_memory",
        "endpoint": "memory create_procedural_memory",
        "wrapper": mem0_wrap,
    },
]


class Mem0Instrumentor(BaseInstrumentor):
    """An instrumentor for mem0's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        """Optimized instrumentation with performance considerations."""
        # Extract configuration once
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        capture_message_content = kwargs.get("capture_message_content")

        # Cache version lookup for better performance
        try:
            version = importlib.metadata.version("mem0ai")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"

        # Pre-create wrapper args to avoid repeated function calls
        wrapper_args = (
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
        )

        # Optimized wrapping with error handling and debugging
        for method_config in WRAPPED_METHODS:
            try:
                print(f"DEBUG: Wrapping {method_config['package']}.{method_config['object']}")
                wrap_function_wrapper(
                    method_config["package"],
                    method_config["object"],
                    method_config["wrapper"](method_config["endpoint"], *wrapper_args),
                )
                print(f"DEBUG: Successfully wrapped {method_config['object']}")
            except (ImportError, AttributeError) as e:
                print(f"DEBUG: Failed to wrap {method_config['object']}: {e}")
                # Gracefully handle missing methods in different mem0 versions
                pass

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass