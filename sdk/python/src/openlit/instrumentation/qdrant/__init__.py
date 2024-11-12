# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Qdrant Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.qdrant.qdrant import general_wrap
from openlit.instrumentation.qdrant.async_qdrant import async_general_wrap

_instruments = ("qdrant-client >= 1.9.0",)

WRAPPED_METHODS = [
    {
        "package": "qdrant_client",
        "object": "QdrantClient.create_collection",
        "endpoint": "qdrant.create_collection",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.delete_collection",
        "endpoint": "qdrant.delete_collection",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.update_collection",
        "endpoint": "qdrant.update_collection",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.upload_collection",
        "endpoint": "qdrant.upload_collection",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.upsert",
        "endpoint": "qdrant.upsert",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.set_payload",
        "endpoint": "qdrant.set_payload",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.overwrite_payload",
        "endpoint": "qdrant.overwrite_payload",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.clear_payload",
        "endpoint": "qdrant.clear_payload",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.delete_payload",
        "endpoint": "qdrant.delete_payload",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.upload_points",
        "endpoint": "qdrant.upload_points",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.update_vectors",
        "endpoint": "qdrant.update_vectors",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.delete_vectors",
        "endpoint": "qdrant.delete_vectors",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.delete",
        "endpoint": "qdrant.delete",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.retrieve",
        "endpoint": "qdrant.retrieve",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.scroll",
        "endpoint": "qdrant.scroll",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.search",
        "endpoint": "qdrant.search",
        "wrapper": general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "QdrantClient.search_groups",
        "endpoint": "qdrant.search_groups",
        "wrapper": general_wrap,
    },
    {

        "package": "qdrant_client",
        "object": "QdrantClient.recommend",
        "endpoint": "qdrant.recommend",
        "wrapper": general_wrap,
    },
    {

        "package": "qdrant_client",
        "object": "QdrantClient.create_payload_index",
        "endpoint": "qdrant.create_payload_index",
        "wrapper": general_wrap,
    },
    {

        "package": "qdrant_client",
        "object": "QdrantClient.query_points",
        "endpoint": "qdrant.query_points",
        "wrapper": general_wrap,
    },

    # Async Client
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.create_collection",
        "endpoint": "qdrant.create_collection",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.delete_collection",
        "endpoint": "qdrant.delete_collection",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.update_collection",
        "endpoint": "qdrant.update_collection",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.upload_collection",
        "endpoint": "qdrant.upload_collection",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.upsert",
        "endpoint": "qdrant.upsert",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.set_payload",
        "endpoint": "qdrant.set_payload",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.overwrite_payload",
        "endpoint": "qdrant.overwrite_payload",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.clear_payload",
        "endpoint": "qdrant.clear_payload",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.delete_payload",
        "endpoint": "qdrant.delete_payload",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.upload_points",
        "endpoint": "qdrant.upload_points",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.update_vectors",
        "endpoint": "qdrant.update_vectors",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.delete_vectors",
        "endpoint": "qdrant.delete_vectors",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.delete",
        "endpoint": "qdrant.delete",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.retrieve",
        "endpoint": "qdrant.retrieve",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.scroll",
        "endpoint": "qdrant.scroll",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.search",
        "endpoint": "qdrant.search",
        "wrapper": async_general_wrap,
    },
    {
        "package": "qdrant_client",
        "object": "AsyncQdrantClient.search_groups",
        "endpoint": "qdrant.search_groups",
        "wrapper": async_general_wrap,
    },
    {

        "package": "qdrant_client",
        "object": "AsyncQdrantClient.recommend",
        "endpoint": "qdrant.recommend",
        "wrapper": async_general_wrap,
    },
    {

        "package": "qdrant_client",
        "object": "AsyncQdrantClient.create_payload_index",
        "endpoint": "qdrant.create_payload_index",
        "wrapper": async_general_wrap,
    },
    {

        "package": "qdrant_client",
        "object": "AsyncQdrantClient.query_points",
        "endpoint": "qdrant.query_points",
        "wrapper": async_general_wrap,
    },
]

class QdrantInstrumentor(BaseInstrumentor):
    """An instrumentor for Qdrant's client library."""

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
        version = importlib.metadata.version("qdrant-client")

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
