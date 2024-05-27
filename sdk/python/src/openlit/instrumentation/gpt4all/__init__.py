# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of GPT4All Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.gpt4all.gpt4all import (
    embed, generate
)

_instruments = ("gpt4all >= 2.6.0",)

class GPT4AllInstrumentor(BaseInstrumentor):
    """
    An instrumentor for GPT4All's client library.
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
        version = importlib.metadata.version("gpt4all")

        # generate
        wrap_function_wrapper(
            "gpt4all",
            "GPT4All.generate",
            generate("gpt4all.generate", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

        # embed
        wrap_function_wrapper(
            "gpt4all",
            "Embed4All.embed",
            embed("gpt4all.embed", version, environment, application_name,
                  tracer, pricing_info, trace_content, metrics, disable_metrics),
        )


    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
