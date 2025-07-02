"""Initializer of Auto Instrumentation of OpenAI Agents Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.openai_agents.openai_agents import (
    create_agent
)
from openlit.instrumentation.openai_agents.async_openai_agents import (
    async_create_agent
)

_instruments = ("openai-agents >= 0.0.3",)

class OpenAIAgentsInstrumentor(BaseInstrumentor):
    """
    An instrumentor for OpenAI Agents client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("openai-agents")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")

        # sync agent creation
        wrap_function_wrapper(
            "agents.agent",
            "Agent.__init__",
            create_agent(version, environment, application_name,
                tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        pass
