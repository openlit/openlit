"""Initializer of Auto Instrumentation of OCI GenAI Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry import trace, _logs
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.oci_genai.oci_genai import chat, generate_text, embed

_instruments = ("oci >= 2.100.0",)


class OCIGenAIInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Oracle Cloud Infrastructure (OCI) GenAI client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("oci")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = trace.get_tracer(__name__)
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = OpenlitConfig.metrics_dict
        disable_metrics = kwargs.get("disable_metrics")
        event_provider = _logs.get_logger_provider().get_logger(__name__)

        # sync chat
        wrap_function_wrapper(
            "oci.generative_ai_inference",
            "GenerativeAiInferenceClient.chat",
            chat(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # sync generate_text (legacy completion API)
        wrap_function_wrapper(
            "oci.generative_ai_inference",
            "GenerativeAiInferenceClient.generate_text",
            generate_text(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
                event_provider,
            ),
        )

        # sync embeddings
        wrap_function_wrapper(
            "oci.generative_ai_inference",
            "GenerativeAiInferenceClient.embed_text",
            embed(
                version,
                environment,
                application_name,
                tracer,
                pricing_info,
                capture_message_content,
                metrics,
                disable_metrics,
            ),
        )

    def _uninstrument(self, **kwargs):
        pass
