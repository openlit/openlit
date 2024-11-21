# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of AG2 Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.ag2.ag2 import (
    wrap_ag2
)

_instruments = ("ag2 >= 0.3.2",)

class AG2Instrumentor(BaseInstrumentor):
    """
    An instrumentor for AG2's client library.
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
        version = importlib.metadata.version("ag2")

        wrap_function_wrapper(
            "autogen.agentchat.conversable_agent",
            "ConversableAgent.initiate_chat",
            wrap_ag2("ag2.initiate_chat", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "autogen.agentchat.conversable_agent",
            "ConversableAgent.generate_reply",
            wrap_ag2("ag2.generate_reply", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )


    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
