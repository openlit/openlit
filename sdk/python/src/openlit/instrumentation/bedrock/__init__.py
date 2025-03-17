# pylint: disable=useless-return, bad-staticmethod-argument, disable=duplicate-code
"""Initializer of Auto Instrumentation of AWS Bedrock Functions"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.bedrock.bedrock import converse

_instruments = ("boto3 >= 1.34.138",)

class BedrockInstrumentor(BaseInstrumentor):
    """
    An instrumentor for AWS Bedrock's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        event_provider = kwargs.get('event_provider')
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("boto3")

        #sync
        wrap_function_wrapper(
            "botocore.client",  
            "ClientCreator.create_client",  
            converse(version, environment, application_name,
                     tracer, event_provider, pricing_info, capture_message_content, metrics, disable_metrics),
        )

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
