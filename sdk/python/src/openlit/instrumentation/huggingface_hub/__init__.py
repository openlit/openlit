"""Initializer of Auto Instrumentation of HuggingFace Hub functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.huggingface_hub.huggingface_hub import general_wrap

_instruments = ("huggingface-hub >= 0.15.0",)


class HuggingFaceHubInstrumentor(BaseInstrumentor):
    """
    An instrumentor for HuggingFace Hub client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")
        tracer = kwargs.get("tracer")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        trace_content = kwargs.get("trace_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("huggingface-hub")

        # Wrap HfApi methods
        wrap_function_wrapper(
            "huggingface_hub",
            "HfApi.__init__",
            general_wrap(
                "__init__",
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                trace_content,
                metrics,
                disable_metrics,
            ),
        )

        # Wrap other HfApi methods
        for method in ("upload_file", "model_info", "repo_info", "list_repo_files"):
            wrap_function_wrapper(
                "huggingface_hub",
                f"HfApi.{method}",
                general_wrap(
                    method,
                    version,
                    environment,
                    application_name,
                    tracer,
                    pricing_info,
                    trace_content,
                    metrics,
                    disable_metrics,
                ),
            )

        # Wrap hf_hub_download
        wrap_function_wrapper(
            "huggingface_hub",
            "hf_hub_download",
            general_wrap(
                "download",
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                trace_content,
                metrics,
                disable_metrics,
            ),
        )

    def _uninstrument(self, **kwargs):
        pass
