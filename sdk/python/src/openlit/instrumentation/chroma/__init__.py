# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Chromadb Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.chroma.chroma import general_wrap

_instruments = ("chromadb >= 0.4.0",)

class ChromaInstrumentor(BaseInstrumentor):
    """An instrumentor for Chromadb's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("chromadb")

        wrap_function_wrapper(
            "chromadb.db",  
            "DB.create_collection",  
            general_wrap("chroma.create_collection", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "chromadb",  
            "Collection.add",  
            general_wrap("chroma.add", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "chromadb",  
            "Collection.get",  
            general_wrap("chroma.get", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "chromadb",  
            "Collection.peek",  
            general_wrap("chroma.peek", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "chromadb",  
            "Collection.query",  
            general_wrap("chroma.query", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "chromadb",  
            "Collection.update",  
            general_wrap("chroma.update", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "chromadb",  
            "Collection.upsert",  
            general_wrap("chroma.upsert", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            "chromadb",  
            "Collection.delete",  
            general_wrap("chroma.delete", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )


    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
