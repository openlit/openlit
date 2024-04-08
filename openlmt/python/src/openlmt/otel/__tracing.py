# pylint: disable=line-too-long
"""
Setups up OpenTelemetry tracer
"""

import os
from opentelemetry import trace
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# Global flag to check if the tracer provider initialization is complete.
TRACER_SET = False

def setup_tracing(application_name="default", tracer=None, otlp_endpoint=None, otlp_headers=None, disable_batch=False):
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
        if not TRACER_SET:
            # Create a resource with the service name attribute.
            resource = Resource(attributes={SERVICE_NAME: application_name})

            # Initialize the TracerProvider with the created resource.
            trace.set_tracer_provider(TracerProvider(resource=resource))

            otlp_endpoint = otlp_endpoint or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
            otlp_headers = otlp_headers or os.getenv("OTEL_EXPORTER_OTLP_HEADERS")

            # Configure span exporter and processor based on provided parameters or defaults.
            if otlp_endpoint:
                span_exporter = OTLPSpanExporter(endpoint=otlp_endpoint, headers=otlp_headers)
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
