# pylint: disable=duplicate-code, line-too-long
"""
Setups up OpenTelemetry Meter
"""
import os
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader, ConsoleMetricExporter
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

from openlit.semcov import SemanticConvetion

# Global flag to check if the meter provider initialization is complete.
METER_SET = False

def setup_meter(application_name, environment, meter, otlp_endpoint, otlp_headers):
    """
    Sets up OpenTelemetry metrics with a counter for total requests.

    Params:
        application_name (str): The name of the application for which metrics are being collected.
        otlp_endpoint (str): The OTLP exporter endpoint for metrics.
        otlp_headers (dict): Headers for the OTLP request.

    Returns:
        A dictionary containing the meter and created metrics for easy access.
    """

    # pylint: disable=global-statement
    global METER_SET

    try:
        if meter is None and not METER_SET:
            # Create a resource with the service name attribute.
            resource = Resource(attributes={
                SERVICE_NAME: application_name,
                DEPLOYMENT_ENVIRONMENT: environment,
                TELEMETRY_SDK_NAME: "openlit"}
            )

            # Only set environment variables if you have a non-None value.
            if otlp_endpoint is not None:
                os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = otlp_endpoint

            if otlp_headers is not None:
                if isinstance(otlp_headers, dict):
                    headers_str = ','.join(f"{key}={value}" for key, value in otlp_headers.items())
                else:
                    headers_str = otlp_headers
                # Now, we have either converted the dict to a string or used the provided string.
                os.environ["OTEL_EXPORTER_OTLP_HEADERS"] = headers_str

            # Configure the span exporter and processor based on whether the endpoint is effectively set.
            if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
                metric_exporter = OTLPMetricExporter()
            else:
                metric_exporter = ConsoleMetricExporter()

            metric_reader = PeriodicExportingMetricReader(metric_exporter)

            meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])

            metrics.set_meter_provider(meter_provider)

            meter = metrics.get_meter(__name__, version="0.1.0")

            METER_SET = True

        # Define and create the metrics
        metrics_dict = {
            "genai_requests": meter.create_counter(
                name=SemanticConvetion.GEN_AI_REQUESTS,
                description="Number of requests to GenAI",
                unit="1",
            ),
            "genai_prompt_tokens": meter.create_counter(
                name=SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                description="Number of prompt tokens processed.",
                unit="1",
            ),
            "genai_completion_tokens": meter.create_counter(
                name=SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                description="Number of completion tokens processed.",
                unit="1",
            ),
            "genai_total_tokens": meter.create_counter(
                name=SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                description="Number of total tokens processed.",
                unit="1",
            ),
            "genai_cost": meter.create_histogram(
                name=SemanticConvetion.GEN_AI_USAGE_COST,
                description="The distribution of GenAI request costs.",
                unit="USD",
            ),
            "db_requests": meter.create_counter(
                name=SemanticConvetion.DB_REQUESTS,
                description="Number of requests to VectorDBs",
                unit="1",
            ),
        }

        return metrics_dict

    # pylint: disable=bare-except
    except:
        return None
