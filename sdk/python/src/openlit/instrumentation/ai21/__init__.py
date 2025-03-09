# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of AI21 Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.ai21.ai21 import (
    chat, chat_rag
)
from openlit.instrumentation.ai21.async_ai21 import (
    async_chat, async_chat_rag
)

_instruments = ('ai21 >= 3.0.0',)

class AI21Instrumentor(BaseInstrumentor):
    """
    An instrumentor for AI21's client library.
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
        version = importlib.metadata.version('ai21')

        #sync
        wrap_function_wrapper(
            'ai21.clients.studio.resources.chat.chat_completions',
            'ChatCompletions.create',
            chat(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'ai21.clients.studio.resources.studio_conversational_rag',
            'StudioConversationalRag.create',
            chat_rag(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        #Async
        wrap_function_wrapper(
            'ai21.clients.studio.resources.chat.async_chat_completions',
            'AsyncChatCompletions.create',
            async_chat(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )
        wrap_function_wrapper(
            'ai21.clients.studio.resources.studio_conversational_rag',
            'AsyncStudioConversationalRag.create',
            async_chat_rag(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
