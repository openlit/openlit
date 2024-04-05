import os
import logging
from opentelemetry import trace
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# Global flag to check if the tracer provider initialization is complete.
is_tracer_provider_set = False

def setup_tracing(application_name="default", tracer=None, otlp_endpoint=None, otlp_headers=None, disable_batch=False):
    """
    Sets up tracing with OpenTelemetry. Initializes the tracer provider and configures the span processor and exporter.

    Params:
        application_name (str): The name of the application to be used in traces.
        tracer (Tracer): Optional custom tracer. If provided, other parameters are ignored.
        otlp_endpoint (str): The OTLP exporter endpoint. Falls back to the OTEL_EXPORTER_OTLP_ENDPOINT environment variable if not specified.
        otlp_headers (dict): Headers for the OTLP request. Falls back to the OTEL_EXPORTER_OTLP_HEADERS environment variable if not specified.
        disable_batch (bool): Flag to disable the batch span processor in favor of a simpler processor for exporting.

    Returns:
        A tracer instance configured according to the given parameters or environment variables.
    """
    global is_tracer_provider_set
    try:
        # Execute the tracing setup only if a custom tracer hasn't been provided and the provider is not yet set.
        if tracer is None and not is_tracer_provider_set:
            # Create a resource with the service name attribute.
            resource = Resource(attributes={SERVICE_NAME: application_name})

            # Initialize the TracerProvider with the created resource.
            trace.set_tracer_provider(TracerProvider(resource=resource))

            # Determine the OTLP endpoint and headers, prioritizing function parameters over environment variables.
            otlp_endpoint = otlp_endpoint or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
            otlp_headers = otlp_headers or os.getenv("OTEL_EXPORTER_OTLP_HEADERS")

            # Use a console exporter if no OTLP endpoint is configured; otherwise, use the OTLP exporter.
            if otlp_endpoint:
                span_exporter = OTLPSpanExporter(endpoint=otlp_endpoint, headers=otlp_headers)
                span_processor = BatchSpanProcessor(span_exporter) if not disable_batch else SimpleSpanProcessor(span_exporter)
            else:
                span_exporter = ConsoleSpanExporter()
                span_processor = SimpleSpanProcessor(span_exporter)

            # Add the chosen span processor to the tracer provider.
            trace.get_tracer_provider().add_span_processor(span_processor)

            # Set the flag to indicate the tracer provider has been configured.
            is_tracer_provider_set = True

        # Create and return a tracer from the tracer provider using the current module's name.
        return trace.get_tracer(__name__)

    except Exception as e:
        # In case of a setup failure, return None to signify the error.
        return None