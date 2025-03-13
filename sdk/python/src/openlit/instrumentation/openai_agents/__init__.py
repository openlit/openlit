"""Initializer of Auto Instrumentation of OpenAI Agents Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.openai_agents.openai_agents import (
    create_agent
)

_instruments = ('openai-agents >= 0.0.3',)

class OpenAIAgentsInstrumentor(BaseInstrumentor):
    """
    An instrumentor for openai-agents's client library.
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
        version = importlib.metadata.version('openai-agents')

        wrap_function_wrapper(
            'agents.agent',
            'Agent.__init__',
            create_agent(version, environment, application_name,
                  tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
