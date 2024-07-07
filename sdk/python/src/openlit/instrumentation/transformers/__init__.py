# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of HuggingFace Transformer Functions"""
from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.transformers.transformers import text_wrap

_instruments = ("transformers >= 4.39.3",)

class TransformersInstrumentor(BaseInstrumentor):
    """An instrumentor for HuggingFace Transformer Functions."""

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name")
        environment = kwargs.get("environment")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info")
        trace_content = kwargs.get("trace_content")
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("transformers")

        wrap_function_wrapper(
            "transformers",  
            "TextGenerationPipeline.__call__",  
            text_wrap("huggingface.text_generation", version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics),
        )

    @staticmethod
    def _uninstrument(self, **kwargs):
        pass
