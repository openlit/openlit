# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of LangChain Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.langchain.langchain import (
    general_wrap,
    hub,
    llm,
    allm,
    chat,
    achat
)

_instruments = ("langchain >= 0.1.20",)

WRAPPED_METHODS = [
    {
        "package": "langchain_community.document_loaders.base",
        "object": "BaseLoader.load",
        "endpoint": "langchain.retrieve.load",
        "wrapper": general_wrap,
    },
    {
        "package": "langchain_community.document_loaders.base",
        "object": "BaseLoader.aload",
        "endpoint": "langchain.retrieve.load",
        "wrapper": general_wrap,
    },
    {
        "package": "langchain_text_splitters.base",
        "object": "TextSplitter.split_documents",
        "endpoint": "langchain.retrieve.split_documents",
        "wrapper": general_wrap,
    },
    {
        "package": "langchain_text_splitters.base",
        "object": "TextSplitter.create_documents",
        "endpoint": "langchain.retrieve.create_documents",
        "wrapper": general_wrap,
    },
    {
        "package": "langchain.hub",
        "object": "pull",
        "endpoint": "langchain.retrieve.prompt",
        "wrapper": hub,
    },
    {
        "package": "langchain_core.language_models.llms",
        "object": "BaseLLM.invoke",
        "endpoint": "langchain.llm",
        "wrapper": llm,
    },
    {
        "package": "langchain_core.language_models.llms",
        "object": "BaseLLM.ainvoke",
        "endpoint": "langchain.llm",
        "wrapper": allm,
    },
    {
        "package": "langchain_core.language_models.chat_models",
        "object": "BaseChatModel.invoke",
        "endpoint": "langchain.chat_models",
        "wrapper": chat,
    },
    {
        "package": "langchain_core.language_models.chat_models",
        "object": "BaseChatModel.ainvoke",
        "endpoint": "langchain.chat_models",
        "wrapper": achat,
    },
]

class LangChainInstrumentor(BaseInstrumentor):
    """An instrumentor for Cohere's client library."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("langchain")

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
