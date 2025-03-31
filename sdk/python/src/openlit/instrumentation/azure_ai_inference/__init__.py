"""Initializer of Auto Instrumentation of Azure AI Inference Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper
from openlit.instrumentation.azure_ai_inference.azure_ai_inference import (
    complete
)
from openlit.instrumentation.azure_ai_inference.async_azure_ai_inference import (
    async_complete
)

_instruments = ('azure-ai-inference >= 1.0.0b4',)

class AzureAIInferenceInstrumentor(BaseInstrumentor):
    """
    An instrumentor for azure-ai-inference's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get('application_name', 'default')
        environment = kwargs.get('environment', 'default')
        tracer = kwargs.get('tracer')
        event_provider = kwargs.get('event_provider')
        metrics = kwargs.get('metrics_dict')
        pricing_info = kwargs.get('pricing_info', {})
        capture_message_content = kwargs.get('capture_message_content', False)
        disable_metrics = kwargs.get('disable_metrics')
        version = importlib.metadata.version('azure-ai-inference')

        # sync generate
        wrap_function_wrapper(
            'azure.ai.inference',
            'ChatCompletionsClient.complete',
            complete(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        # async generate
        wrap_function_wrapper(
            'azure.ai.inference.aio',
            'ChatCompletionsClient.complete',
            async_complete(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
