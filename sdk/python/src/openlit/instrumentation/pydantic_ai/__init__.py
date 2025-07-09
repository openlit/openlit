"""Initializer of Auto Instrumentation of Pydantic AI Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.pydantic_ai.pydantic_ai import (
    agent_create, agent_run, async_agent_run
)

_instruments = ('pydantic-ai >= 0.2.17',)

class PydanticAIInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Pydantic AI's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get('application_name', 'default_application')
        environment = kwargs.get('environment', 'default_environment')
        tracer = kwargs.get('tracer')
        metrics = kwargs.get('metrics_dict')
        pricing_info = kwargs.get('pricing_info', {})
        capture_message_content = kwargs.get('capture_message_content', False)
        disable_metrics = kwargs.get('disable_metrics')
        version = importlib.metadata.version('pydantic-ai')

        wrap_function_wrapper(
            'pydantic_ai.agent',
            'Agent.__init__',
            agent_create(version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            'pydantic_ai.agent',
            'Agent.run_sync',
            agent_run(version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            'pydantic_ai.agent',
            'Agent.run',
            async_agent_run(version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
