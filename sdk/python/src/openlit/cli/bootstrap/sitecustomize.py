"""
OpenLIT Auto-Initialization Bootstrap

This module automatically initializes OpenLIT when Python starts
if OPENLIT_AUTO_INSTRUMENT environment variable is set.

This follows the same pattern as OpenTelemetry's auto-instrumentation.
"""

import os
import sys
import logging

# Import the centralized configuration
try:
    # First try absolute import
    from openlit.cli.config import build_config_from_environment
except ImportError:
    try:
        # Try relative import as fallback
        from ..config import build_config_from_environment
    except ImportError:
        # Final fallback - build config manually from environment
        def build_config_from_environment():
            import os

            config = {}

            # Map environment variables to OpenLIT parameters
            env_mappings = {
                "OTEL_SERVICE_NAME": "application_name",
                "OTEL_DEPLOYMENT_ENVIRONMENT": "environment",
                "OTEL_EXPORTER_OTLP_ENDPOINT": "otlp_endpoint",
                "OTEL_EXPORTER_OTLP_HEADERS": "otlp_headers",
                "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT": "capture_message_content",
                "OPENLIT_DISABLED_INSTRUMENTORS": "disabled_instrumentors",
                "OPENLIT_DISABLE_BATCH": "disable_batch",
                "OPENLIT_DISABLE_METRICS": "disable_metrics",
                "OPENLIT_COLLECT_GPU_STATS": "collect_gpu_stats",
                "OPENLIT_DETAILED_TRACING": "detailed_tracing",
                "OPENLIT_PRICING_JSON": "pricing_json",
            }

            for env_var, param_name in env_mappings.items():
                env_value = os.environ.get(env_var)
                if env_value:
                    # Handle boolean values
                    if env_var in [
                        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT",
                        "OPENLIT_DISABLE_BATCH",
                        "OPENLIT_DISABLE_METRICS",
                        "OPENLIT_COLLECT_GPU_STATS",
                        "OPENLIT_DETAILED_TRACING",
                    ]:
                        config[param_name] = env_value.lower() in ("true", "1", "yes")
                    # Handle CSV values
                    elif env_var == "OPENLIT_DISABLED_INSTRUMENTORS":
                        config[param_name] = [
                            item.strip()
                            for item in env_value.split(",")
                            if item.strip()
                        ]
                    # Handle JSON values
                    elif env_var == "OTEL_EXPORTER_OTLP_HEADERS":
                        try:
                            import json

                            config[param_name] = json.loads(env_value)
                        except (json.JSONDecodeError, ImportError):
                            pass
                    else:
                        config[param_name] = env_value

            return config


# Set up logging for auto-instrumentation
logger = logging.getLogger(__name__)


def auto_initialize_openlit():
    """Automatically initialize OpenLIT if environment suggests it."""
    # Check if auto-instrumentation is enabled
    if not os.environ.get("OPENLIT_AUTO_INSTRUMENT", "").lower() in (
        "true",
        "1",
        "yes",
    ):
        return

    try:
        # Import OpenLIT and initialize
        import openlit

        # Build configuration from environment variables
        config = build_config_from_environment()

        # Initialize OpenLIT with environment variables
        openlit.init(**config)

    except ImportError as e:
        logger.error("OpenLIT not found. Please ensure openlit is installed: %s", e)
    except Exception as e:
        # Log error but don't break the application
        logger.error("OpenLIT auto-instrumentation failed: %s", e)


# Auto-initialize when module is imported
auto_initialize_openlit()
