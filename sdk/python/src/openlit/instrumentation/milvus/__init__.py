"""
OpenLIT Milvus Instrumentation
"""

from typing import Collection
import importlib.metadata
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.milvus.milvus import general_wrap

_instruments = ("pymilvus >= 2.4.3",)

# Operations to wrap for Milvus client
MILVUS_OPERATIONS = [
    ("create_collection", "milvus.create_collection"),
    ("drop_collection", "milvus.drop_collection"),
    ("insert", "milvus.insert"),
    ("upsert", "milvus.upsert"),
    ("search", "milvus.search"),
    ("query", "milvus.query"),
    ("get", "milvus.get"),
    ("delete", "milvus.delete"),
]


class MilvusInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Milvus's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("pymilvus")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = OpenlitConfig.metrics_dict
        disable_metrics = kwargs.get("disable_metrics")

        # Wrap operations
        for method_name, endpoint in MILVUS_OPERATIONS:
            wrap_function_wrapper(
                "pymilvus",
                f"MilvusClient.{method_name}",
                general_wrap(
                    endpoint,
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    capture_message_content,
                    metrics,
                    disable_metrics,
                ),
            )

    def _uninstrument(self, **kwargs):
        pass
