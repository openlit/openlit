"""Initializer of Auto Instrumentation of LangChain Community Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.langchain_community.langchain_community import (
    general_wrap,
)
from openlit.instrumentation.langchain_community.async_langchain_community import (
    async_general_wrap,
)

_instruments = ("langchain-community >= 0.2.0",)

WRAPPED_METHODS = [
    {
        "package": "langchain_community.document_loaders.base",
        "object": "BaseLoader.load",
        "endpoint": "langchain_community.retrieve.load",
        "wrapper": general_wrap,
    },
    {
        "package": "langchain_community.document_loaders.base",
        "object": "BaseLoader.aload",
        "endpoint": "langchain_community.retrieve.load",
        "wrapper": async_general_wrap,
    },
    {
        "package": "langchain_text_splitters.base",
        "object": "TextSplitter.split_documents",
        "endpoint": "langchain_community.retrieve.split_documents",
        "wrapper": general_wrap,
    },
    {
        "package": "langchain_text_splitters.base",
        "object": "TextSplitter.create_documents",
        "endpoint": "langchain_community.retrieve.create_documents",
        "wrapper": general_wrap,
    },
]


class LangChainCommunityInstrumentor(BaseInstrumentor):
    """
    An instrumentor for LangChain Community client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("langchain-community")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")

        for wrapped_method in WRAPPED_METHODS:
            wrap_package = wrapped_method.get("package")
            wrap_object = wrapped_method.get("object")
            gen_ai_endpoint = wrapped_method.get("endpoint")
            wrapper = wrapped_method.get("wrapper")
            wrap_function_wrapper(
                wrap_package,
                wrap_object,
                wrapper(
                    gen_ai_endpoint,
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
