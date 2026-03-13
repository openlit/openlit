"""
Singleton configuration class for OpenLIT.

Extracted into its own module to avoid circular imports between
``openlit.__init__`` and ``openlit.__helpers``.
"""


class OpenlitConfig:
    """
    A Singleton Configuration class for openLIT.

    This class maintains a single instance of configuration settings including
    environment details, application name, and tracing information throughout the openLIT package.

    Attributes:
        environment (str): Deployment environment of the application.
        application_name (str): Name of the application using openLIT.
        pricing_info (Dict[str, Any]): Pricing information.
        tracer (Optional[Any]): Tracer instance for OpenTelemetry.
        event_provider (Optional[Any]): Event logger provider for OpenTelemetry.
        otlp_endpoint (Optional[str]): Endpoint for OTLP.
        otlp_headers (Optional[Dict[str, str]]): Headers for OTLP.
        disable_batch (bool): Flag to disable batch span processing in tracing.
        capture_message_content (bool): Flag to enable or disable tracing of content.
        detailed_tracing (bool): Flag to enable detailed component-level tracing.
    """

    _instance = None

    def __new__(cls):
        """Ensures that only one instance of the configuration exists."""
        if cls._instance is None:
            cls._instance = super(OpenlitConfig, cls).__new__(cls)
            cls.reset_to_defaults()
        return cls._instance

    @classmethod
    def reset_to_defaults(cls):
        """Resets configuration to default values."""
        cls.environment = "default"
        cls.application_name = "default"
        cls.pricing_info = {}
        cls.tracer = None
        cls.event_provider = None
        cls.metrics_dict = {}
        cls.otlp_endpoint = None
        cls.otlp_headers = None
        cls.disable_batch = False
        cls.capture_message_content = True
        cls.disable_metrics = False
        cls.detailed_tracing = True
        cls.capture_parameters = False
        cls.enable_sqlcommenter = False
        cls.evals_logs_export = True
        cls.max_content_length = None  # None = no truncation

    @classmethod
    def update_config(
        cls,
        environment,
        application_name,
        tracer,
        event_provider,
        otlp_endpoint,
        otlp_headers,
        disable_batch,
        capture_message_content,
        metrics_dict,
        disable_metrics,
        pricing_info,
        detailed_tracing,
        capture_parameters=False,
        enable_sqlcommenter=False,
        evals_logs_export=True,
        max_content_length=None,
    ):
        """
        Updates the configuration based on provided parameters.

        Args:
            environment (str): Deployment environment.
            application_name (str): Application name.
            tracer: Tracer instance.
            event_provider: Event logger provider instance.
            otlp_endpoint (str): OTLP endpoint.
            otlp_headers (Dict[str, str]): OTLP headers.
            disable_batch (bool): Disable batch span processing flag.
            capture_message_content (bool): Enable or disable content tracing.
            metrics_dict: Dictionary of metrics.
            disable_metrics (bool): Flag to disable metrics.
            pricing_info (dict): Already-resolved pricing information dict.
            detailed_tracing (bool): Flag to enable detailed component-level tracing.
            capture_parameters (bool): Capture database query parameters (security risk).
            enable_sqlcommenter (bool): Inject trace context as SQL comments.
            evals_logs_export (bool): Emit evaluation results as OTEL Log Records instead of OTEL Events.
            max_content_length: Maximum character length for captured content (None = no limit).
        """
        cls.environment = environment
        cls.application_name = application_name
        cls.pricing_info = pricing_info
        cls.tracer = tracer
        cls.event_provider = event_provider
        cls.metrics_dict = metrics_dict
        cls.otlp_endpoint = otlp_endpoint
        cls.otlp_headers = otlp_headers
        cls.disable_batch = disable_batch
        cls.capture_message_content = capture_message_content
        cls.disable_metrics = disable_metrics
        cls.detailed_tracing = detailed_tracing
        cls.capture_parameters = capture_parameters
        cls.enable_sqlcommenter = enable_sqlcommenter
        cls.evals_logs_export = evals_logs_export
        cls.max_content_length = max_content_length
