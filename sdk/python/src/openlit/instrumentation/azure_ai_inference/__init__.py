# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Azure AI Inference Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.azure_ai_inference.azure_ai_inference import (
    complete, embedding
)

from openlit.instrumentation.azure_ai_inference.async_azure_ai_inference import (
    async_complete, async_embedding
)

_instruments = ("azure-ai-inference >= 1.0.0b4",)

class AzureAIInferenceInstrumentor(BaseInstrumentor):
    """
    An instrumentor for azure-ai-inference's client library.
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
        version = importlib.metadata.version("azure-ai-inference")

        # sync generate
        wrap_function_wrapper(
            "azure.ai.inference",
            "ChatCompletionsClient.complete",
            complete("azure_ai.complete", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # sync embedding
        wrap_function_wrapper(
            "azure.ai.inference",
            "EmbeddingsClient.embed",
            embedding("azure_ai.embed", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # async generate
        wrap_function_wrapper(
            "azure.ai.inference.aio",
            "ChatCompletionsClient.complete",
            async_complete("azure_ai.complete", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # async embedding
        wrap_function_wrapper(
            "azure.ai.inference.aio",
            "EmbeddingsClient.embed",
            async_embedding("azure_ai.embed", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
