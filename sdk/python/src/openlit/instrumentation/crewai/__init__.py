# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of CrewAI Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.crewai.crewai import (
    crew_wrap
)

_instruments = ("crewai >= 0.80.0",)

class CrewAIInstrumentor(BaseInstrumentor):
    """
    An instrumentor for CrewAI's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("crewai")

        wrap_function_wrapper(
            "crewai.agent",
            "Agent.execute_task",
            crew_wrap("crewai.agent_execute_task", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "crewai.task",
            "Task._execute_core",
            crew_wrap("crewai.task_execute_core", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )


    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
