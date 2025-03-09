"""Initializer of Auto Instrumentation of Anthropic Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.anthropic.anthropic import messages
from openlit.instrumentation.anthropic.async_anthropic import async_messages

_instruments = ('anthropic >= 0.21.0',)

class AnthropicInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Anthropic's client library.
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
        version = importlib.metadata.version('anthropic')

        #sync
        wrap_function_wrapper(
            'anthropic.resources.messages',  
            'Messages.create',  
            messages(version, environment, application_name,
                     tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        #async
        wrap_function_wrapper(
            'anthropic.resources.messages',  
            'AsyncMessages.create',  
            async_messages(version, environment, application_name,
                            tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
