"""Tests that environment variables in PARAMETER_CONFIG reach openlit.init()."""

import logging

import pytest

import openlit
import openlit.otel.metrics as metrics_module
from openlit.cli.config import PARAMETER_CONFIG, parse_env_value

# Env values that are not a JSON object; none of them may reach OpenlitConfig.
NON_OBJECT_JSON_VALUES = ["[]", '["team"]', '"team"', "123", "true", "null"]

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

    @pytest.mark.parametrize("param", ["custom_span_attributes", "custom_metrics_attributes"])
    @pytest.mark.parametrize("env_value", NON_OBJECT_JSON_VALUES + ["{not json"])
    def test_non_object_custom_attributes_are_ignored(self, monkeypatch, param, env_value):
        """Anything that is not a JSON object must leave the default {} in place."""
        monkeypatch.setenv("OPENLIT_DISABLE_METRICS", "true")
        monkeypatch.setenv(PARAMETER_CONFIG[param]["env_var"], env_value)
        openlit.init()
        assert getattr(openlit.OpenlitConfig, param) == {}


class TestJsonObjectParser:
    """parse_env_value() for parameters declared with parser="json_object"."""

    JSON_OBJECT_PARAMS = [
        name for name, cfg in PARAMETER_CONFIG.items() if cfg.get("parser") == "json_object"
    ]

    def test_custom_attribute_params_use_json_object_parser(self):
        """Only custom_span_attributes and custom_metrics_attributes use parser="json_object"."""
        assert set(self.JSON_OBJECT_PARAMS) == {
            "custom_span_attributes",
            "custom_metrics_attributes",
        }

    @pytest.mark.parametrize("param", JSON_OBJECT_PARAMS)
    def test_object_is_accepted(self, param):
        """A JSON object string is decoded to the matching dict."""
        assert parse_env_value(param, '{"team": "ml", "tier": 1}') == {"team": "ml", "tier": 1}

    @pytest.mark.parametrize("param", JSON_OBJECT_PARAMS)
    @pytest.mark.parametrize("env_value", NON_OBJECT_JSON_VALUES)
    def test_non_object_is_rejected_with_warning(self, caplog, param, env_value):
        """Valid JSON that is not an object returns None and warns that a JSON object was expected."""
        with caplog.at_level(logging.WARNING, logger="openlit.cli.config"):
            assert parse_env_value(param, env_value) is None
        assert PARAMETER_CONFIG[param]["env_var"] in caplog.text
        assert "JSON object" in caplog.text

    @pytest.mark.parametrize("param", JSON_OBJECT_PARAMS)
    def test_invalid_json_is_rejected_with_warning(self, caplog, param):
        """Malformed JSON returns None and warns that the env var is not valid JSON."""
        with caplog.at_level(logging.WARNING, logger="openlit.cli.config"):
            assert parse_env_value(param, "{not json") is None
        assert PARAMETER_CONFIG[param]["env_var"] in caplog.text
        assert "not valid JSON" in caplog.text

    def test_plain_json_parser_is_unchanged(self):
        """otlp_headers keeps the permissive "json" parser; exporters handle non-dicts."""
        assert parse_env_value("otlp_headers", '["a"]') == ["a"]
        assert parse_env_value("otlp_headers", "Authorization=Bearer x") is None
