# pylint: disable=duplicate-code, line-too-long
"""
Setups up OpenTelemetry tracer
"""

import os
from opentelemetry import trace
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor
from opentelemetry.sdk.trace.export import ConsoleSpanExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter


# Global flag to check if the tracer provider initialization is complete.
TRACER_SET = False

def setup_tracing(application_name, environment, tracer, otlp_endpoint, otlp_headers, disable_batch):
    """
    Sets up tracing with OpenTelemetry. Initializes the tracer provider and configures the span processor and exporter.

    Params:
        application_name (str): The name of the application to be used in traces.
        tracer (Tracer): Optional custom tracer. If provided, it is immediately returned and no setup is performed.
        otlp_endpoint (str): The OTLP exporter endpoint. Falls back to the OTEL_EXPORTER_OTLP_ENDPOINT environment variable if not specified.
        otlp_headers (dict): Headers for the OTLP request. Falls back to the OTEL_EXPORTER_OTLP_HEADERS environment variable if not specified.
        disable_batch (bool): Flag to disable the batch span processor in favor of a simpler processor for exporting.

    Returns:
        The provided custom tracer if not None; otherwise, a tracer instance configured according to the given parameters or environment variables.
    """

    # If an external tracer is provided, return it immediately.
    if tracer is not None:
        return tracer

    # Proceed with setting up a new tracer or configuration only if TRACER_SET is False.
    # pylint: disable=global-statement
    global TRACER_SET

    try:
        #Disable Haystack Auto Tracing
        os.environ["HAYSTACK_AUTO_TRACE_ENABLED"] = "false"

        if not TRACER_SET:
            # Create a resource with the service name attribute.
            resource = Resource(attributes={
                SERVICE_NAME: application_name,
                DEPLOYMENT_ENVIRONMENT: environment,
                TELEMETRY_SDK_NAME: "openlit"}
            )

            # Initialize the TracerProvider with the created resource.
            trace.set_tracer_provider(TracerProvider(resource=resource))

            # Only set environment variables if you have a non-None value.
            if otlp_endpoint is not None:
                os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = otlp_endpoint

            if otlp_headers is not None:
                if isinstance(otlp_headers, dict):
                    headers_str = ','.join(f"{key}={value}" for key, value in otlp_headers.items())
                else:
                    headers_str = otlp_headers

                os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = headers_str

            # Configure the span exporter and processor based on whether the endpoint is effectively set.
            if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
                span_exporter = OTLPSpanExporter()

                span_processor = BatchSpanProcessor(span_exporter) if not disable_batch else SimpleSpanProcessor(span_exporter)
            else:
                span_exporter = ConsoleSpanExporter()
                span_processor = SimpleSpanProcessor(span_exporter)

            trace.get_tracer_provider().add_span_processor(span_processor)

            TRACER_SET = True

        return trace.get_tracer(__name__)

    # pylint: disable=bare-except
    except:
        return None
