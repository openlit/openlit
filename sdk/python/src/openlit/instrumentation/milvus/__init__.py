# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Milvus Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.milvus.milvus import general_wrap

_instruments = ("pymilvus >= 2.4.3",)

WRAPPED_METHODS = [
    {
        "package": "pymilvus",
        "object": "MilvusClient.create_collection",
        "endpoint": "milvus.create_collection",
        "wrapper": general_wrap,
    },
    {
        "package": "pymilvus",
        "object": "MilvusClient.drop_collection",
        "endpoint": "milvus.drop_collection",
        "wrapper": general_wrap,
    },
    {
        "package": "pymilvus",
        "object": "MilvusClient.insert",
        "endpoint": "milvus.insert",
        "wrapper": general_wrap,
    },
    {
        "package": "pymilvus",
        "object": "MilvusClient.upsert",
        "endpoint": "milvus.upsert",
        "wrapper": general_wrap,
    },
    {
        "package": "pymilvus",
        "object": "MilvusClient.search",
        "endpoint": "milvus.search",
        "wrapper": general_wrap,
    },
    {
        "package": "pymilvus",
        "object": "MilvusClient.query",
        "endpoint": "milvus.query",
        "wrapper": general_wrap,
    },
    {
        "package": "pymilvus",
        "object": "MilvusClient.get",
        "endpoint": "milvus.get",
        "wrapper": general_wrap,
    },
    {
        "package": "pymilvus",
        "object": "MilvusClient.delete",
        "endpoint": "milvus.delete",
        "wrapper": general_wrap,
    },
]

class MilvusInstrumentor(BaseInstrumentor):
    """An instrumentor for Milvus's client library."""

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
        version = importlib.metadata.version("pymilvus")

        for wrapped_method in WRAPPED_METHODS:
            wrap_package = wrapped_method.get("package")
            wrap_object = wrapped_method.get("object")
            gen_ai_endpoint = wrapped_method.get("endpoint")
            wrapper = wrapped_method.get("wrapper")
            wrap_function_wrapper(
                wrap_package,
                wrap_object,
                wrapper(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
            )


    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
