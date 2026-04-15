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
        otlp_endpoint (Optional[str]): Endpoint for OTLP.
        otlp_headers (Optional[Dict[str, str]]): Headers for OTLP.
        disable_batch (bool): Flag to disable batch span processing in tracing.
        capture_message_content (bool): Flag to enable or disable tracing of content.
        disable_events (bool): Flag to disable OTel Logger event emission.
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
        cls.metrics_dict = {}
        cls.otlp_endpoint = None
        cls.otlp_headers = None
        cls.disable_batch = False
        cls.capture_message_content = True
        cls.disable_metrics = False
        cls.disable_events = False
        cls.capture_db_parameters = False
        cls.evals_logs_export = True
        cls.max_content_length = None  # None = no truncation
        cls.custom_span_attributes = {}
        cls.custom_metrics_attributes = {}

    @classmethod
    def update_config(
        cls,
        environment,
        application_name,
        otlp_endpoint,
        otlp_headers,
        disable_batch,
        capture_message_content,
        metrics_dict,
        disable_metrics,
        pricing_info,
        disable_events=False,
        capture_db_parameters=False,
        evals_logs_export=True,
        max_content_length=None,
        custom_span_attributes=None,
        custom_metrics_attributes=None,
    ):
        """
        Updates the configuration based on provided parameters.

        Args:
            environment (str): Deployment environment.
            application_name (str): Application name.
            otlp_endpoint (str): OTLP endpoint.
            otlp_headers (Dict[str, str]): OTLP headers.
            disable_batch (bool): Disable batch span processing flag.
            capture_message_content (bool): Enable or disable content tracing.
            metrics_dict: Dictionary of metrics instruments.
            disable_metrics (bool): Flag to disable metrics.
            pricing_info (dict): Already-resolved pricing information dict.
            disable_events (bool): Flag to disable OTel Logger event emission.
            capture_db_parameters (bool): Capture database query parameters (security risk).
            evals_logs_export (bool): Emit evaluation results as OTEL Log Records instead of OTEL Events.
            max_content_length: Maximum character length for captured content (None = no limit).
            custom_span_attributes (dict): Custom key-value attributes applied to every span.
            custom_metrics_attributes (dict): Custom key-value attributes applied to every metric.
        """
        cls.environment = environment
        cls.application_name = application_name
        cls.pricing_info = pricing_info
        cls.metrics_dict = metrics_dict
        cls.otlp_endpoint = otlp_endpoint
        cls.otlp_headers = otlp_headers
        cls.disable_batch = disable_batch
        cls.capture_message_content = capture_message_content
        cls.disable_metrics = disable_metrics
        cls.disable_events = disable_events
        cls.capture_db_parameters = capture_db_parameters
        cls.evals_logs_export = evals_logs_export
        cls.max_content_length = max_content_length
        cls.custom_span_attributes = custom_span_attributes or {}
        cls.custom_metrics_attributes = custom_metrics_attributes or {}
