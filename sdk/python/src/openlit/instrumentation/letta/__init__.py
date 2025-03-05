# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of Letta Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.letta.letta import (
    create_agent, send_message
)

_instruments = ("letta >= 0.6.2",)

class LettaInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Letta's client library.
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
        version = importlib.metadata.version("letta")

        wrap_function_wrapper(
            "letta.client.client",
            "LocalClient.create_agent",
            create_agent("letta.create_agent", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "letta.client.client",
            "LocalClient.get_agent",
            create_agent("letta.get_agent", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "letta.client.client",
            "LocalClient.send_message",
            send_message("letta.send_message", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "letta.client.client",
            "RESTClient.create_agent",
            create_agent("letta.create_agent", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "letta.client.client",
            "RESTClient.get_agent",
            create_agent("letta.get_agent", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

        wrap_function_wrapper(
            "letta.client.client",
            "RESTClient.send_message",
            send_message("letta.send_message", version, environment, application_name,
                  tracer, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
