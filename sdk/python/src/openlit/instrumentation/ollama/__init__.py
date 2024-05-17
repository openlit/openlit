# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Ollama Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.ollama.ollama import (
    chat, embeddings, generate
)
from openlit.instrumentation.ollama.async_ollama import (
    async_chat, async_embeddings, async_generate
)

_instruments = ("ollama >= 0.2.0",)

class OllamaInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Ollama's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        trace_content = kwargs.get("trace_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("ollama")

        # sync chat
        wrap_function_wrapper(
            "ollama",
            "chat",
            chat("ollama.chat", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            "ollama",
            "Client.chat",
            chat("ollama.chat", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # sync embeddings
        wrap_function_wrapper(
            "ollama",
            "embeddings",
            embeddings("ollama.embeddings", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            "ollama",
            "Client.embeddings",
            embeddings("ollama.embeddings", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # sync generate
        wrap_function_wrapper(
            "ollama",
            "generate",
            generate("ollama.generate", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            "ollama",
            "Client.generate",
            generate("ollama.generate", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # async chat
        wrap_function_wrapper(
            "ollama",
            "AsyncClient.chat",
            async_chat("ollama.chat", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # async embeddings
        wrap_function_wrapper(
            "ollama",
            "AsyncClient.embeddings",
            async_embeddings("ollama.embeddings", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # aync generate
        wrap_function_wrapper(
            "ollama",
            "AsyncClient.generate",
            async_generate("ollama.generate", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
