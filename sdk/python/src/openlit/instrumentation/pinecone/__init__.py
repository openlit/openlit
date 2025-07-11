"""Initializer of Auto Instrumentation of Pinecone Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.pinecone.pinecone import general_wrap
from openlit.instrumentation.pinecone.async_pinecone import async_general_wrap

_instruments = ("pinecone >= 7.3.0",)

class PineconeInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Pinecone's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("pinecone")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")

        # Sync operations
        wrap_function_wrapper(
            "pinecone.pinecone",
            "Pinecone.create_index",
            general_wrap("pinecone.create_collection", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.pinecone",
            "Pinecone.create_index_for_model",
            general_wrap("pinecone.create_collection", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index",
            "Index.upsert",
            general_wrap("pinecone.upsert", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index",
            "Index.upsert_records",
            general_wrap("pinecone.upsert_records", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index",
            "Index.query",
            general_wrap("pinecone.query", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index",
            "Index.search",
            general_wrap("pinecone.search", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index",
            "Index.fetch",
            general_wrap("pinecone.fetch", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index",
            "Index.search_records",
            general_wrap("pinecone.search_records", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index",
            "Index.update",
            general_wrap("pinecone.update", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index",
            "Index.delete",
            general_wrap("pinecone.delete", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        # Async operations
        wrap_function_wrapper(
            "pinecone.pinecone_asyncio",
            "PineconeAsyncio.create_index",
            async_general_wrap("pinecone.create_index", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.pinecone_asyncio",
            "PineconeAsyncio.create_index_for_model",
            async_general_wrap("pinecone.create_index", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index_asyncio",
            "_IndexAsyncio.upsert",
            async_general_wrap("pinecone.upsert", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index_asyncio",
            "_IndexAsyncio.upsert_records",
            async_general_wrap("pinecone.upsert_records", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index_asyncio",
            "_IndexAsyncio.query",
            async_general_wrap("pinecone.query", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index_asyncio",
            "_IndexAsyncio.search",
            async_general_wrap("pinecone.search", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index_asyncio",
            "_IndexAsyncio.fetch",
            async_general_wrap("pinecone.fetch", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index_asyncio",
            "_IndexAsyncio.search_records",
            async_general_wrap("pinecone.search_records", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index_asyncio",
            "_IndexAsyncio.update",
            async_general_wrap("pinecone.update", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "pinecone.db_data.index_asyncio",
            "_IndexAsyncio.delete",
            async_general_wrap("pinecone.delete", version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        pass
