# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of EmbedChain Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.embedchain.embedchain import evaluate, get_data_sources

_instruments = ("embedchain >= 0.1.104",)

WRAPPED_METHODS = [
    {
        "package": "embedchain",
        "object": "App.evaluate",
        "endpoint": "embedchain.evaluate",
        "wrapper": evaluate,
    },
    {
        "package": "embedchain",
        "object": "App.get_data_sources",
        "endpoint": "embedchain.get_data_sources",
        "wrapper": get_data_sources,
    },
]

class EmbedChainInstrumentor(BaseInstrumentor):
    """An instrumentor for EmbedChain's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")
        version = importlib.metadata.version("embedchain")

        for wrapped_method in WRAPPED_METHODS:
            wrap_package = wrapped_method.get("package")
            wrap_object = wrapped_method.get("object")
            gen_ai_endpoint = wrapped_method.get("endpoint")
            wrapper = wrapped_method.get("wrapper")
            wrap_function_wrapper(
                wrap_package,
                wrap_object,
                wrapper(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content),
            )

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
