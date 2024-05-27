# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of LlamaIndex Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.llamaindex.llamaindex import load_data

_instruments = ("llama-index >= 0.10.0",)

WRAPPED_METHODS = [
    {
        "package": "llama_index.core.readers",
        "object": "SimpleDirectoryReader.load_data",
        "endpoint": "llamaindex.load_data",
        "wrapper": load_data,
    },
    {
        "package": "llama_index.core.node_parser",
        "object": "SentenceSplitter.get_nodes_from_documents",
        "endpoint": "llamaindex.data_splitter",
        "wrapper": load_data,
    },
]

class LlamaIndexInstrumentor(BaseInstrumentor):
    """An instrumentor for LlamaIndex's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")
        version = importlib.metadata.version("llama-index")

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
