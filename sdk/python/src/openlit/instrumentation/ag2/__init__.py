"""Initializer of Auto Instrumentation of AG2 Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.ag2.ag2 import (
    conversable_agent, agent_run
)

_instruments = ('ag2 >= 0.3.2',)

class AG2Instrumentor(BaseInstrumentor):
    """
    An instrumentor for AG2's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get('application_name', 'default_application')
        environment = kwargs.get('environment', 'default_environment')
        tracer = kwargs.get('tracer')
        event_provider = kwargs.get('event_provider')
        metrics = kwargs.get('metrics_dict')
        pricing_info = kwargs.get('pricing_info', {})
        capture_message_content = kwargs.get('capture_message_content', False)
        disable_metrics = kwargs.get('disable_metrics')
        version = importlib.metadata.version('ag2')

        wrap_function_wrapper(
            'autogen.agentchat.conversable_agent',
            'ConversableAgent.__init__',
            conversable_agent(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            'autogen.agentchat.conversable_agent',
            'ConversableAgent.run',
            agent_run(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
