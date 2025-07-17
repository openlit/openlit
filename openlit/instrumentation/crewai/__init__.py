"""
OpenLIT CrewAI Instrumentation - OpenTelemetry Integration
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.crewai.crewai import general_wrap
from openlit.instrumentation.crewai.async_crewai import async_general_wrap

_instruments = ("crewai >= 0.0.1",)


class CrewAIInstrumentor(BaseInstrumentor):
    """
    An instrumentor for CrewAI
    https://github.com/joaomdmoura/crewai
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("crewai")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        # Wrap crew operations
        try:
            wrap_function_wrapper(
                "crewai.crew",
                "Crew.kickoff",
                general_wrap(
                    "crew.kickoff", version, environment, application_name,
                    tracer, pricing_info, capture_message_content, metrics,
                    disable_metrics, detailed_tracing=detailed_tracing
                ),
            )
        except (ImportError, AttributeError):
            pass  # Module may not exist in all versions

        try:
            wrap_function_wrapper(
                "crewai.crew",
                "Crew.kickoff_async",
                async_general_wrap(
                    "crew.kickoff_async", version, environment,
                    application_name, tracer, pricing_info,
                    capture_message_content, metrics, disable_metrics,
                    detailed_tracing=detailed_tracing
                ),
            )
        except (ImportError, AttributeError):
            pass  # Module may not exist in all versions

        # Wrap additional crew operations
        crew_operations = [
            "kickoff_for_each", "kickoff_for_each_async"
        ]

        for operation in crew_operations:
            try:
                if "async" in operation:
                    wrap_function_wrapper(
                        "crewai.crew",
                        f"Crew.{operation}",
                        async_general_wrap(
                            f"crew.{operation}", version, environment,
                            application_name, tracer, pricing_info,
                            capture_message_content, metrics, disable_metrics,
                            detailed_tracing=detailed_tracing
                        ),
                    )
                else:
                    wrap_function_wrapper(
                        "crewai.crew",
                        f"Crew.{operation}",
                        general_wrap(
                            f"crew.{operation}", version, environment,
                            application_name, tracer, pricing_info,
                            capture_message_content, metrics, disable_metrics,
                            detailed_tracing=detailed_tracing
                        ),
                    )
            except (ImportError, AttributeError):
                pass  # Module may not exist in all versions

        # Wrap agent operations
        agent_operations = [
            "execute_task", "execute_task_async", "ask_question",
            "ask_question_async"
        ]

        for operation in agent_operations:
            try:
                if "async" in operation:
                    wrap_function_wrapper(
                        "crewai.agent",
                        f"Agent.{operation}",
                        async_general_wrap(
                            f"agent.{operation}", version, environment,
                            application_name, tracer, pricing_info,
                            capture_message_content, metrics, disable_metrics,
                            detailed_tracing=detailed_tracing
                        ),
                    )
                else:
                    wrap_function_wrapper(
                        "crewai.agent",
                        f"Agent.{operation}",
                        general_wrap(
                            f"agent.{operation}", version, environment,
                            application_name, tracer, pricing_info,
                            capture_message_content, metrics, disable_metrics,
                            detailed_tracing=detailed_tracing
                        ),
                    )
            except (ImportError, AttributeError):
                pass  # Module may not exist in all versions

        # Total operations: 8 workflow + 4 async + (12 component if detailed)
        # = 12 baseline, 24 with detailed tracing

    def _uninstrument(self, **kwargs):
        pass 