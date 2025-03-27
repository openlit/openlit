# pylint: disable=duplicate-code, line-too-long, ungrouped-imports
"""
Setups up OpenTelemetry Meter
"""
import os
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader, ConsoleMetricExporter
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from opentelemetry.sdk.resources import Resource
from openlit.semcov import SemanticConvention

if os.environ.get("OTEL_EXPORTER_OTLP_PROTOCOL") == "grpc":
    from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
else:
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

# Global flag to check if the meter provider initialization is complete.
METER_SET = False

_DB_CLIENT_OPERATION_DURATION_BUCKETS = [
    0.001,
    0.005,
    0.01,
    0.05,
    0.1,
    0.5,
    1,
    5,
    10
]

_GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS = [
    0.01,
    0.02,
    0.04,
    0.08,
    0.16,
    0.32,
    0.64,
    1.28,
    2.56,
    5.12,
    10.24,
    20.48,
    40.96,
    81.92,
]

_GEN_AI_SERVER_TBT = [
    0.01,
    0.025,
    0.05,
    0.075,
    0.1,
    0.15,
    0.2,
    0.3,
    0.4,
    0.5,
    0.75,
    1.0,
    2.5
]

_GEN_AI_SERVER_TFTT = [
    0.001,
    0.005,
    0.01,
    0.02,
    0.04,
    0.06,
    0.08,
    0.1,
    0.25,
    0.5,
    0.75,
    1.0,
    2.5,
    5.0,
    7.5,
    10.0
]

_GEN_AI_CLIENT_TOKEN_USAGE_BUCKETS = [
    1,
    4,
    16,
    64,
    256,
    1024,
    4096,
    16384,
    65536,
    262144,
    1048576,
    4194304,
    16777216,
    67108864,
]

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
            resource = Resource.create(attributes={
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
            # OTel Semconv
            "genai_client_usage_tokens": meter.create_histogram(
                name=SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE,
                description="Measures number of input and output tokens used",
                unit="{token}",
                explicit_bucket_boundaries_advisory=_GEN_AI_CLIENT_TOKEN_USAGE_BUCKETS,
            ),
            "genai_client_operation_duration": meter.create_histogram(
                name=SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION,
                description="GenAI operation duration",
                unit="s",
                explicit_bucket_boundaries_advisory=_GEN_AI_CLIENT_OPERATION_DURATION_BUCKETS,
            ),
            "genai_server_tbt": meter.create_histogram(
                name=SemanticConvention.GEN_AI_SERVER_TBT,
                description="Time per output token generated after the first token for successful responses",
                unit="s",
                explicit_bucket_boundaries_advisory=_GEN_AI_SERVER_TBT,
            ),
            "genai_server_ttft": meter.create_histogram(
                name=SemanticConvention.GEN_AI_SERVER_TTFT,
                description="Time to generate first token for successful responses",
                unit="s",
                explicit_bucket_boundaries_advisory=_GEN_AI_SERVER_TFTT,
            ),
            "db_client_operation_duration": meter.create_histogram(
                name=SemanticConvention.DB_CLIENT_OPERATION_DURATION,
                description="DB operation duration",
                unit="s",
                explicit_bucket_boundaries_advisory=_DB_CLIENT_OPERATION_DURATION_BUCKETS,
            ),

            # Extra
            "genai_requests": meter.create_counter(
                name=SemanticConvention.GEN_AI_REQUESTS,
                description="Number of requests to GenAI",
                unit="1",
            ),
            "genai_prompt_tokens": meter.create_counter(
                name=SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
                description="Number of prompt tokens processed.",
                unit="1",
            ),
            "genai_completion_tokens": meter.create_counter(
                name=SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
                description="Number of completion tokens processed.",
                unit="1",
            ),
            "genai_cost": meter.create_histogram(
                name=SemanticConvention.GEN_AI_USAGE_COST,
                description="The distribution of GenAI request costs.",
                unit="USD",
            ),
            "db_requests": meter.create_counter(
                name=SemanticConvention.DB_REQUESTS,
                description="Number of requests to VectorDBs",
                unit="1",
            ),
        }

        return metrics_dict, None

    # pylint: disable=broad-exception-caught
    except Exception as err:
        return None, err
