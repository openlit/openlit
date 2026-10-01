"""Tests that environment variables in PARAMETER_CONFIG reach openlit.init()."""

import pytest

import openlit
import openlit.otel.metrics as metrics_module
from openlit.cli.config import PARAMETER_CONFIG

# (parameter, env value, OpenlitConfig attribute, expected value)
ENV_CASES = [
    ("environment", "staging", "environment", "staging"),
    ("service_name", "my-service", "application_name", "my-service"),
    ("disable_batch", "true", "disable_batch", True),
    ("capture_message_content", "false", "capture_message_content", False),
    ("disable_metrics", "true", "disable_metrics", True),
    ("disable_events", "true", "disable_events", True),
    ("capture_db_parameters", "true", "capture_db_parameters", True),
    # Kept as a string from the env var; truncate_content() converts it with int().
    ("max_content_length", "42", "max_content_length", "42"),
    ("custom_span_attributes", '{"team": "ml"}', "custom_span_attributes", {"team": "ml"}),
    ("custom_metrics_attributes", '{"team": "ml"}', "custom_metrics_attributes", {"team": "ml"}),
]

# Parameters whose env value is not stored on OpenlitConfig under its own name.
NOT_STORED_ON_CONFIG = {
    "application_name": "deprecated alias that shares OTEL_SERVICE_NAME with service_name",
    "otlp_endpoint": "read directly by the OpenTelemetry exporters",
    "otlp_headers": "read directly by the OpenTelemetry exporters",
    "disabled_instrumentors": "decides which instrumentors run",
    "controller_mode": "decides which instrumentors run",
    "pricing_json": "resolved into pricing_info",
    "collect_gpu_stats": "starts the GPU collector",
    "collect_system_metrics": "starts the system metrics collector",
}


class TestEnvVarsReachInit:
    """Every env var declared in PARAMETER_CONFIG should be applied by openlit.init()."""

    def setup_method(self):
        """Reset global state before each test."""
        metrics_module.METER_SET = False
        openlit.OpenlitConfig.reset_to_defaults()

    def test_every_parameter_is_covered(self):
        """New PARAMETER_CONFIG entries must be added to ENV_CASES or NOT_STORED_ON_CONFIG."""
        covered = {case[0] for case in ENV_CASES} | set(NOT_STORED_ON_CONFIG)
        assert set(PARAMETER_CONFIG) == covered

    @pytest.mark.parametrize("param, env_value, attribute, expected", ENV_CASES)
    def test_env_var_is_applied(self, monkeypatch, param, env_value, attribute, expected):
        """Setting the env var alone should change the matching OpenlitConfig value."""
        monkeypatch.setenv("OPENLIT_DISABLE_METRICS", "true")
        monkeypatch.setenv(PARAMETER_CONFIG[param]["env_var"], env_value)
        openlit.init()
        assert getattr(openlit.OpenlitConfig, attribute) == expected
