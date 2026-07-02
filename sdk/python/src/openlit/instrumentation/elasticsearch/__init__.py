"""
OpenLIT Elasticsearch Instrumentation
"""

from typing import Collection
import importlib.metadata
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.elasticsearch.elasticsearch import general_wrap
from openlit.instrumentation.elasticsearch.async_elasticsearch import async_general_wrap

_instruments = ("elasticsearch >= 8.0.0",)

ELASTICSEARCH_OPERATIONS = [
    ("search", "elasticsearch.search"),
    ("msearch", "elasticsearch.msearch"),
    ("index", "elasticsearch.index"),
    ("bulk", "elasticsearch.bulk"),
    ("get", "elasticsearch.get"),
    ("mget", "elasticsearch.mget"),
    ("update", "elasticsearch.update"),
    ("delete", "elasticsearch.delete"),
]

ELASTICSEARCH_INDICES_OPERATIONS = [
    ("create", "elasticsearch.indices.create"),
    ("delete", "elasticsearch.indices.delete"),
]


class ElasticsearchInstrumentor(BaseInstrumentor):
    """
    An instrumentor for the Elasticsearch Python client.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("elasticsearch")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = OpenlitConfig.metrics_dict
        disable_metrics = kwargs.get("disable_metrics")

        # pylint: disable=import-outside-toplevel
        from elasticsearch import Elasticsearch, AsyncElasticsearch

        wrap_kwargs = dict(
            version=version,
            environment=environment,
            application_name=application_name,
            tracer=tracer,
            pricing_info=pricing_info,
            capture_message_content=capture_message_content,
            metrics=metrics,
            disable_metrics=disable_metrics,
        )

        for method_name, endpoint in ELASTICSEARCH_OPERATIONS:
            if hasattr(Elasticsearch, method_name):
                wrap_function_wrapper(
                    "elasticsearch",
                    f"Elasticsearch.{method_name}",
                    general_wrap(endpoint, **wrap_kwargs),
                )
            if hasattr(AsyncElasticsearch, method_name):
                wrap_function_wrapper(
                    "elasticsearch",
                    f"AsyncElasticsearch.{method_name}",
                    async_general_wrap(endpoint, **wrap_kwargs),
                )

        for method_name, endpoint in ELASTICSEARCH_INDICES_OPERATIONS:
            if hasattr(Elasticsearch, "indices") and hasattr(
                Elasticsearch.indices, method_name
            ):
                wrap_function_wrapper(
                    "elasticsearch",
                    f"Elasticsearch.indices.{method_name}",
                    general_wrap(endpoint, **wrap_kwargs),
                )
            if hasattr(AsyncElasticsearch, "indices") and hasattr(
                AsyncElasticsearch.indices, method_name
            ):
                wrap_function_wrapper(
                    "elasticsearch",
                    f"AsyncElasticsearch.indices.{method_name}",
                    async_general_wrap(endpoint, **wrap_kwargs),
                )

    def _uninstrument(self, **kwargs):
        pass
