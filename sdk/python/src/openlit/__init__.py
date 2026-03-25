# pylint: disable=broad-exception-caught
"""
The __init__.py module for the openLIT package.
This module sets up the openLIT configuration and instrumentation for various
large language models (LLMs).
"""

from typing import Dict
import logging
import os
from importlib.util import find_spec
from functools import wraps
from contextlib import contextmanager
import requests

# Import internal modules for setting up tracing and fetching pricing info.
from opentelemetry import trace as t
from opentelemetry.trace import SpanKind, Status, StatusCode, Span
from opentelemetry.sdk.resources import SERVICE_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.semcov import SemanticConvention
from openlit.otel.tracing import setup_tracing
from openlit.otel.metrics import setup_meter
from openlit.otel.events import setup_events
from openlit.__helpers import (
    fetch_pricing_info,
    get_env_variable,
    set_agent_name,
    reset_agent_name,
    record_agent_invocation,
    record_agent_tool_error,
)
from openlit._config import OpenlitConfig  # noqa: F401 — re-exported for public API
from openlit._instrumentors import MODULE_NAME_MAP, get_all_instrumentors

# Import GPU instrumentor separately as it doesn't follow the standard pattern
from openlit.instrumentation.gpu import GPUInstrumentor

# Import guards and evals
import openlit.guard
import openlit.evals

# Set up logging for error and information messages.
logger = logging.getLogger(__name__)


def module_exists(module_name):
    """Check if nested modules exist, addressing the dot notation issue."""
    parts = module_name.split(".")
    for i in range(1, len(parts) + 1):
        if find_spec(".".join(parts[:i])) is None:
            return False
    return True


def is_opentelemetry_instrumentor(instrumentor_name):
    """Check if the instrumentor is an official OpenTelemetry instrumentor."""
    opentelemetry_instrumentors = {
        "asgi",
        "django",
        "fastapi",
        "flask",
        "pyramid",
        "starlette",
        "falcon",
        "tornado",
        "aiohttp-client",
        "httpx",
        "requests",
        "urllib",
        "urllib3",
    }
    return instrumentor_name in opentelemetry_instrumentors


def instrument_if_available(
    instrumentor_name, instrumentor_instance, config, disabled_instrumentors
):
    """Instruments the specified instrumentor if its library is available."""
    if instrumentor_name in disabled_instrumentors:
        logger.info("Instrumentor %s is disabled", instrumentor_name)
        return

    module_name = MODULE_NAME_MAP.get(instrumentor_name)
    if not module_name:
        logger.error("No module mapping for %s", instrumentor_name)
        return

    try:
        if module_exists(module_name):
            if is_opentelemetry_instrumentor(instrumentor_name):
                # OpenTelemetry instrumentations use the standard instrument() method
                instrumentor_instance.instrument()
                logger.info("OpenTelemetry instrumentor %s enabled", instrumentor_name)
            else:
                # OpenLIT custom instrumentations use extended parameters
                instrumentor_instance.instrument(
                    environment=config.environment,
                    application_name=config.application_name,
                    tracer=config.tracer,
                    event_provider=config.event_provider,
                    pricing_info=config.pricing_info,
                    capture_message_content=config.capture_message_content,
                    metrics_dict=config.metrics_dict,
                    disable_metrics=config.disable_metrics,
                    detailed_tracing=config.detailed_tracing,
                    capture_parameters=config.capture_parameters,
                    enable_sqlcommenter=config.enable_sqlcommenter,
                )
        else:
            logger.info(
                "Library for %s (%s) not found. Skipping instrumentation",
                instrumentor_name,
                module_name,
            )
    except Exception as e:
        logger.error("Failed to instrument %s: %s", instrumentor_name, e)


def init(
    environment="default",
    application_name="default",
    service_name="default",
    tracer=None,
    event_logger=None,
    otlp_endpoint=None,
    otlp_headers=None,
    disable_batch=False,
    capture_message_content=True,
    disabled_instrumentors=None,
    meter=None,
    disable_metrics=False,
    pricing_json=None,
    collect_gpu_stats=False,
    detailed_tracing=True,
    collect_system_metrics=False,
    capture_parameters=False,
    enable_sqlcommenter=False,
    evals_logs_export=True,
    max_content_length=None,
):
    """
    Initializes the openLIT configuration and setups tracing.

    This function sets up the openLIT environment with provided configurations
    and initializes instrumentors for tracing.

    Args:
        environment (str): Deployment environment.
        application_name (str): Application name.
        tracer: Tracer instance (Optional).
        event_logger: OTel Logger instance for emitting events (Optional).
        meter: OpenTelemetry Metrics Instance (Optional).
        otlp_endpoint (str): OTLP endpoint for exporter (Optional).
        otlp_headers (Dict[str, str]): OTLP headers for exporter (Optional).
        disable_batch (bool): Flag to disable batch span processing (Optional).
        capture_message_content (bool): Flag to trace content (Optional).
        disabled_instrumentors (List[str]): Optional. List of instrumentor names to disable.
        disable_metrics (bool): Flag to disable metrics (Optional).
        pricing_json(str): File path or url to the pricing json (Optional).
        collect_gpu_stats (bool): Flag to enable or disable GPU metrics collection.
        detailed_tracing (bool): Enable detailed component-level tracing for debugging and optimization.
                                Defaults to False to use workflow-level tracing with minimal storage overhead.
        max_content_length (int): Maximum character length for captured content attributes (prompts,
                                 completions, tool output, etc.). None (default) means no truncation.
                                 Set to a positive integer to truncate content to that length.
    """
    disabled_instrumentors = disabled_instrumentors if disabled_instrumentors else []
    logger.info("Starting openLIT initialization...")

    # Handle service_name/application_name migration
    # service_name takes precedence over application_name if both are provided
    if service_name != "default":
        # service_name explicitly provided, use it
        final_service_name = service_name
    elif application_name != "default":
        # Only application_name provided, use it (silent for backward compatibility)
        final_service_name = application_name
    else:
        # Both are default, will be handled by environment variables below
        final_service_name = "default"

    # Apply environment variables for parameters not explicitly provided
    # Environment variables take precedence over default values but not over explicit parameters
    try:
        from openlit.cli.config import build_config_from_environment

        env_config = build_config_from_environment()

        # Apply env vars only if function parameters are at their default values
        if environment == "default" and "environment" in env_config:
            environment = env_config["environment"]

        # Handle service name from environment (both service_name and application_name map to same env var)
        if final_service_name == "default":
            final_service_name = env_config.get(
                "service_name",
                env_config.get(
                    "application_name", "default"
                ),  # Fallback for backward compatibility
            )
        # Skip otlp_endpoint and otlp_headers - let existing code handle them
        if disable_batch is False and "disable_batch" in env_config:
            disable_batch = env_config["disable_batch"]
        if capture_message_content is True and "capture_message_content" in env_config:
            capture_message_content = env_config["capture_message_content"]
        if not disabled_instrumentors and "disabled_instrumentors" in env_config:
            disabled_instrumentors = env_config["disabled_instrumentors"]
        if disable_metrics is False and "disable_metrics" in env_config:
            disable_metrics = env_config["disable_metrics"]
        if pricing_json is None and "pricing_json" in env_config:
            pricing_json = env_config["pricing_json"]
        if collect_gpu_stats is False and "collect_gpu_stats" in env_config:
            collect_gpu_stats = env_config["collect_gpu_stats"]
        if detailed_tracing is True and "detailed_tracing" in env_config:
            detailed_tracing = env_config["detailed_tracing"]
        if collect_system_metrics is False and "collect_system_metrics" in env_config:
            collect_system_metrics = env_config["collect_system_metrics"]
        if capture_parameters is False and "capture_parameters" in env_config:
            capture_parameters = env_config["capture_parameters"]
        if enable_sqlcommenter is False and "enable_sqlcommenter" in env_config:
            enable_sqlcommenter = env_config["enable_sqlcommenter"]
        if evals_logs_export is True and "evals_logs_export" in env_config:
            evals_logs_export = env_config["evals_logs_export"]
        if max_content_length is None and "max_content_length" in env_config:
            max_content_length = env_config["max_content_length"]

    except ImportError:
        # Fallback if config module is not available - continue without env var support
        pass

    # Validate disabled instrumentors
    invalid_instrumentors = [
        name for name in disabled_instrumentors if name not in MODULE_NAME_MAP
    ]
    for invalid_name in invalid_instrumentors:
        logger.warning(
            "Invalid instrumentor name detected and ignored: '%s'", invalid_name
        )

    try:
        # Retrieve or create the single configuration instance.
        config = OpenlitConfig()

        # Setup tracing based on the provided or default configuration.
        tracer = setup_tracing(
            application_name=final_service_name,
            environment=environment,
            tracer=tracer,
            otlp_endpoint=otlp_endpoint,
            otlp_headers=otlp_headers,
            disable_batch=disable_batch,
        )

        if not tracer:
            logger.error("OpenLIT tracing setup failed. Tracing will not be available.")
            return

        # Setup events based on the provided or default configuration.
        event_provider = setup_events(
            application_name=final_service_name,
            environment=environment,
            event_logger=event_logger,
            otlp_endpoint=None,
            otlp_headers=None,
            disable_batch=disable_batch,
        )

        if not event_provider:
            logger.error("OpenLIT events setup failed. Events will not be available")

        # Setup meter and receive metrics_dict instead of meter.
        metrics_dict, err = setup_meter(
            application_name=final_service_name,
            environment=environment,
            meter=meter,
            otlp_endpoint=otlp_endpoint,
            otlp_headers=otlp_headers,
        )

        if err:
            logger.error(
                "OpenLIT metrics setup failed. Metrics will not be available: %s", err
            )
            # Set metrics_dict to None and disable metrics instead of returning early
            metrics_dict = None
            disable_metrics = True

        if (
            os.getenv("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "").lower()
            == "false"
        ):
            capture_message_content = False

        # Update global configuration with the provided settings.
        config.update_config(
            environment,
            final_service_name,
            tracer,
            event_provider,
            otlp_endpoint,
            otlp_headers,
            disable_batch,
            capture_message_content,
            metrics_dict,
            disable_metrics,
            fetch_pricing_info(pricing_json),
            detailed_tracing,
            capture_parameters,
            enable_sqlcommenter,
            evals_logs_export,
            max_content_length,
        )

        # Create instrumentor instances dynamically
        instrumentor_instances = get_all_instrumentors()

        # Initialize and instrument only the enabled instrumentors
        for name, instrumentor in instrumentor_instances.items():
            instrument_if_available(name, instrumentor, config, disabled_instrumentors)

        # Handle GPU instrumentation separately (only if GPU is found)
        if not disable_metrics and collect_gpu_stats:
            gpu_instrumentor = GPUInstrumentor()
            if gpu_instrumentor._get_gpu_type():  # Only instrument if GPU is detected
                gpu_instrumentor.instrument(
                    environment=config.environment,
                    application_name=config.application_name,
                )
            else:
                logger.info("No GPU detected, skipping GPU metrics collection")

        # Handle OpenTelemetry System Metrics instrumentation
        if not disable_metrics and collect_system_metrics:
            try:
                from opentelemetry.instrumentation.system_metrics import (
                    SystemMetricsInstrumentor,
                )

                SystemMetricsInstrumentor().instrument()

                # Auto-enable GPU metrics if GPU is detected (comprehensive system monitoring)
                gpu_instrumentor = GPUInstrumentor()
                if gpu_instrumentor._get_gpu_type():
                    gpu_instrumentor.instrument(
                        environment=config.environment,
                        application_name=config.application_name,
                    )

            except ImportError:
                logger.warning(
                    "OpenTelemetry system metrics not available. "
                    "Install with: pip install opentelemetry-instrumentation-system-metrics"
                )
            except Exception as e:
                logger.error("Failed to enable system metrics: %s", e)
    except Exception as e:
        logger.error("Error during openLIT initialization: %s", e)


def get_prompt(
    url=None,
    name=None,
    api_key=None,
    prompt_id=None,
    version=None,
    should_compile=None,
    variables=None,
    meta_properties=None,
):
    """
    Retrieve and returns the prompt from OpenLIT Prompt Hub
    """

    # Validate and set the base URL
    url = get_env_variable(
        "OPENLIT_URL",
        url,
        "Missing OpenLIT URL: Provide as arg or set OPENLIT_URL env var.",
    )

    # Validate and set the API key
    api_key = get_env_variable(
        "OPENLIT_API_KEY",
        api_key,
        "Missing API key: Provide as arg or set OPENLIT_API_KEY env var.",
    )

    # Construct the API endpoint
    endpoint = url + "/api/prompt/get-compiled"

    # Prepare the payload
    payload = {
        "name": name,
        "promptId": prompt_id,
        "version": version,
        "shouldCompile": should_compile,
        "variables": variables,
        "metaProperties": meta_properties,
        "source": "python-sdk",
    }

    # Remove None values from payload
    payload = {k: v for k, v in payload.items() if v is not None}

    # Prepare headers
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        # Make the POST request to the API with headers
        response = requests.post(endpoint, json=payload, headers=headers, timeout=120)

        # Check if the response is successful
        response.raise_for_status()

        # Return the JSON response
        return response.json()
    except requests.RequestException as error:
        logger.error("Error fetching prompt: '%s'", error)
        return None


def get_secrets(url=None, api_key=None, key=None, tags=None, should_set_env=None):
    """
    Retrieve & returns the secrets from OpenLIT Vault & sets all to env is should_set_env is True
    """

    # Validate and set the base URL
    url = get_env_variable(
        "OPENLIT_URL",
        url,
        "Missing OpenLIT URL: Provide as arg or set OPENLIT_URL env var.",
    )

    # Validate and set the API key
    api_key = get_env_variable(
        "OPENLIT_API_KEY",
        api_key,
        "Missing API key: Provide as arg or set OPENLIT_API_KEY env var.",
    )

    # Construct the API endpoint
    endpoint = url + "/api/vault/get-secrets"

    # Prepare the payload
    payload = {"key": key, "tags": tags, "source": "python-sdk"}

    # Remove None values from payload
    payload = {k: v for k, v in payload.items() if v is not None}

    # Prepare headers
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        # Make the POST request to the API with headers
        response = requests.post(endpoint, json=payload, headers=headers, timeout=120)

        # Check if the response is successful
        response.raise_for_status()

        # Return the JSON response
        vault_response = response.json()

        res = vault_response.get("res", [])

        if should_set_env is True:
            for token, value in res.items():
                os.environ[token] = str(value)
        return vault_response
    except requests.RequestException as error:
        logger.error("Error fetching secrets: '%s'", error)
        return None


def evaluate_rule(
    url=None,
    api_key=None,
    entity_type=None,
    fields=None,
    include_entity_data=False,
    entity_inputs=None,
):
    """
    Evaluate rules against the OpenLIT Rule Engine and retrieve matching
    rules, entities, and optionally entity data (contexts, prompts, etc.).

    Args:
        url (str): OpenLIT dashboard URL. Falls back to OPENLIT_URL env var.
        api_key (str): API key for authentication. Falls back to OPENLIT_API_KEY env var.
        entity_type (str): Type of entity to match — "context", "prompt", or "evaluation".
        fields (dict): Trace attributes to evaluate against rules.
            e.g. {"gen_ai.system": "openai", "gen_ai.request.model": "gpt-4"}
        include_entity_data (bool): If True, include full entity data in response.
        entity_inputs (dict): Optional inputs for entity resolution (e.g. prompt variables).

    Returns:
        dict: Server response with matchingRuleIds, entities, and optionally entity_data.
        None: If the request fails.
    """

    # Validate and set the base URL
    url = get_env_variable(
        "OPENLIT_URL",
        url,
        "Missing OpenLIT URL: Provide as arg or set OPENLIT_URL env var.",
    )

    # Validate and set the API key
    api_key = get_env_variable(
        "OPENLIT_API_KEY",
        api_key,
        "Missing API key: Provide as arg or set OPENLIT_API_KEY env var.",
    )

    # Construct the API endpoint
    endpoint = url + "/api/rule-engine/evaluate"

    # Prepare the payload
    payload = {
        "entity_type": entity_type,
        "fields": fields,
        "include_entity_data": include_entity_data,
        "entity_inputs": entity_inputs,
        "source": "python-sdk",
    }

    # Remove None values from payload
    payload = {k: v for k, v in payload.items() if v is not None}

    # Prepare headers
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        # Make the POST request to the API with headers
        response = requests.post(endpoint, json=payload, headers=headers, timeout=120)

        # Check if the response is successful
        response.raise_for_status()

        # Return the JSON response
        return response.json()
    except requests.RequestException as error:
        logger.error("Error evaluating rule: '%s'", error)
        return None


def log_agent_invocation(source, target, system=None):
    """
    Record that one agent invoked another.

    Usage:
        openlit.log_agent_invocation("orchestrator", "product_agent")
    """
    try:
        metrics = OpenlitConfig.metrics_dict
        if metrics:
            record_agent_invocation(metrics, source, target, system)
    except Exception as e:
        logger.debug("Failed to record agent invocation: %s", e)


def log_agent_tool_error(agent_name, tool_name, system=None, model=None):
    """
    Record that a tool execution failed for an agent.

    Usage:
        openlit.log_agent_tool_error("cart_agent", "add_to_cart",
                                      system="anthropic", model="claude-haiku-4-5")
    """
    try:
        metrics = OpenlitConfig.metrics_dict
        if metrics:
            record_agent_tool_error(
                metrics, agent_name, tool_name, system=system, model=model
            )
    except Exception as e:
        logger.debug("Failed to record agent tool error: %s", e)


@contextmanager
def agent_context(name):
    """
    Context manager that sets the current agent name for metric attribution.

    Any LLM calls made within this context will have their metrics tagged
    with gen_ai.agent.name=<name>.

    Usage:
        with openlit.agent_context("product_agent"):
            # LLM calls here will be attributed to product_agent
            client.messages.create(...)
    """
    token = set_agent_name(name)
    try:
        yield
    finally:
        reset_agent_name(token)


def trace(wrapped):
    """
    Generates a telemetry wrapper for messages to collect metrics.
    """
    if not callable(wrapped):
        raise TypeError(
            f"@trace can only be applied to callable objects, got {type(wrapped).__name__}"
        )

    try:
        __trace = t.get_tracer_provider()
        tracer = __trace.get_tracer(__name__)
    except Exception as tracer_exception:
        logging.error(
            "Failed to initialize tracer: %s", tracer_exception, exc_info=True
        )
        raise

    @wraps(wrapped)
    def wrapper(*args, **kwargs):
        with tracer.start_as_current_span(
            name=wrapped.__name__,
            kind=SpanKind.CLIENT,
        ) as span:
            response = None
            try:
                response = wrapped(*args, **kwargs)
                span.set_attribute(
                    SemanticConvention.GEN_AI_OUTPUT_MESSAGES, response or ""
                )
                span.set_status(Status(StatusCode.OK))
            except Exception as e:
                span.record_exception(e)
                span.set_status(status=Status(StatusCode.ERROR), description=str(e))
                logging.error("Error in %s: %s", wrapped.__name__, e, exc_info=True)
                raise

            try:
                span.set_attribute("function.args", str(args))
                span.set_attribute("function.kwargs", str(kwargs))
                span.set_attribute(
                    SERVICE_NAME,
                    OpenlitConfig.application_name,
                )
                span.set_attribute(DEPLOYMENT_ENVIRONMENT, OpenlitConfig.environment)
            except Exception as meta_exception:
                logging.error(
                    "Failed to set metadata for %s: %s",
                    wrapped.__name__,
                    meta_exception,
                    exc_info=True,
                )

            return response

    return wrapper


class TracedSpan:
    """
    A wrapper class for an OpenTelemetry span that provides helper methods
    for setting result and metadata attributes on the span.

    Attributes:
        _span (Span): The underlying OpenTelemetry span.
    """

    def __init__(self, span):
        """
        Initializes the TracedSpan with the given span.

        Params:
            span (Span): The OpenTelemetry span to be wrapped.
        """

        self._span: Span = span

    def set_result(self, result):
        """
        Sets the result attribute on the underlying span.

        Params:
            result: The result to be set as an attribute on the span.
        """

        self._span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, result)

    def set_metadata(self, metadata: Dict):
        """
        Sets multiple attributes on the underlying span.

        Params:
            metadata (Dict): A dictionary of attributes to be set on the span.
        """

        self._span.set_attributes(attributes=metadata)

    def __enter__(self):
        """
        Enters the context of the TracedSpan, returning itself.

        Returns:
            TracedSpan: The instance of TracedSpan.
        """

        return self

    def __exit__(self, _exc_type, _exc_val, _exc_tb):
        """
        Exits the context of the TracedSpan by ending the underlying span.
        """

        self._span.end()


@contextmanager
def start_trace(name: str):
    """
    A context manager that starts a new trace and provides a TracedSpan
    for usage within the context.

    Params:
        name (str): The name of the span.

    Yields:
        TracedSpan: The wrapped span for trace operations.
    """

    __trace = t.get_tracer_provider()
    with __trace.get_tracer(__name__).start_as_current_span(
        name,
        kind=SpanKind.CLIENT,
    ) as span:
        yield TracedSpan(span)
