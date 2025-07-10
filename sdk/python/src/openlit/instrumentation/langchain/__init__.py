"""Initializer of Auto Instrumentation of LangChain Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.langchain.langchain import (
    hub,
    chat
)
from openlit.instrumentation.langchain.async_langchain import (
    async_hub,
    async_chat
)

_instruments = ("langchain >= 0.1.20",)

WRAPPED_METHODS = [
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
        "wrapper": chat,
    },
    {
        "package": "langchain_core.language_models.llms",
        "object": "BaseLLM.ainvoke",
        "endpoint": "langchain.llm",
        "wrapper": async_chat,
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
        "wrapper": async_chat,
    },
    {
        "package": "langchain.chains.base",
        "object": "Chain.invoke",
        "endpoint": "langchain.chain.invoke",
        "wrapper": chat,
    },
    {
        "package": "langchain.chains.base",
        "object": "Chain.ainvoke",
        "endpoint": "langchain.chain.invoke",
        "wrapper": async_chat,
    }
]

class LangChainInstrumentor(BaseInstrumentor):
    """
    An instrumentor for LangChain client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("langchain")
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
                wrapper(gen_ai_endpoint, version, environment, application_name,
                       tracer, pricing_info, capture_message_content, metrics, disable_metrics),
            )

    def _uninstrument(self, **kwargs):
        pass
