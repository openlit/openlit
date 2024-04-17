# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Pinecone Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.pinecone.pinecone import general_wrap

_instruments = ("pinecone-client >= 2.2.0",)

class PineconeInstrumentor(BaseInstrumentor):
    """An instrumentor for Pinecone's client library."""

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
        version = importlib.metadata.version("pinecone-client")

        wrap_function_wrapper(
            "pinecone.control.pinecone",  
            "Pinecone.create_index",
            general_wrap("pinecone.create_index", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.data.index",  
            "Index.upsert",
            general_wrap("pinecone.upsert", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.data.index",  
            "Index.query",
            general_wrap("pinecone.query", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.data.index",  
            "Index.update",
            general_wrap("pinecone.update", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.data.index",  
            "Index.delete",
            general_wrap("pinecone.delete", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )


    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
