"""Tests that metrics survive repeated openlit.init() calls (setup_meter re-entry)."""

import openlit
import openlit.otel.metrics as metrics_module
from openlit.otel.metrics import setup_meter


def _reset_global_state():
    """Reset setup_meter flags and the singleton config between tests."""
    metrics_module.METER_SET = False
    openlit.OpenlitConfig.reset_to_defaults()


def _call_setup_meter():
    """Call setup_meter with the same arguments openlit.init() passes."""
    return setup_meter(
        application_name="reinit-test",
        environment="test",
        meter=None,
        otlp_endpoint=None,
        otlp_headers=None,
    )


class TestSetupMeterReinit:
    """setup_meter() must reacquire a meter when it runs on a second init()."""

    def setup_method(self):
        """Reset global state before each test."""
        _reset_global_state()

    def teardown_method(self):
        """Reset global state after each test."""
        _reset_global_state()

    def test_setup_meter_twice_returns_metrics_dict(self):
        """A second setup_meter(meter=None) call must return instruments, not an error."""
        first_dict, first_err = _call_setup_meter()
        assert first_err is None
        assert first_dict

        second_dict, second_err = _call_setup_meter()
        assert second_err is None
        assert second_dict
        assert set(second_dict) == set(first_dict)

    def test_openlit_init_twice_keeps_metrics_enabled(self):
        """A second openlit.init() must not disable metrics or blank metrics_dict."""
        openlit.init()
        assert openlit.OpenlitConfig.disable_metrics is False
        assert openlit.OpenlitConfig.metrics_dict

        openlit.init()
        assert openlit.OpenlitConfig.disable_metrics is False
        assert openlit.OpenlitConfig.metrics_dict
