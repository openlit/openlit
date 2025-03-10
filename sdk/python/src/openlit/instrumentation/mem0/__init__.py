# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of mem0 Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.mem0.mem0 import mem0_wrap

_instruments = ("mem0ai >= 0.1.32",)

WRAPPED_METHODS = [
    {
        "package": "mem0",
        "object": "Memory.add",
        "endpoint": "mem0.memory_add",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.get_all",
        "endpoint": "mem0.memory_get_all",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.get",
        "endpoint": "mem0.memory_get",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.search",
        "endpoint": "mem0.memory_search",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.update",
        "endpoint": "mem0.memory_update",
        "wrapper": mem0_wrap,
    },
    {
        "package": "mem0",
        "object": "Memory.update",
        "endpoint": "mem0.memory_update",
        "wrapper": mem0_wrap,
    },
]

class Mem0Instrumentor(BaseInstrumentor):
    """An instrumentor for mem0's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        capture_message_content = kwargs.get("capture_message_content")
        version = importlib.metadata.version("mem0ai")

        for wrapped_method in WRAPPED_METHODS:
            wrap_package = wrapped_method.get("package")
            wrap_object = wrapped_method.get("object")
            gen_ai_endpoint = wrapped_method.get("endpoint")
            wrapper = wrapped_method.get("wrapper")
            wrap_function_wrapper(
                wrap_package,
                wrap_object,
                wrapper(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, capture_message_content),
            )

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
