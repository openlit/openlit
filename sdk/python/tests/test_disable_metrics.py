"""Tests for disable_metrics in openlit.init()."""

import openlit
import openlit.otel.metrics as metrics_module


class TestDisableMetrics:
    """Regression tests for issue #1319."""

    def setup_method(self):
        """Reset meter state before each test."""
        metrics_module.METER_SET = False
        openlit.OpenlitConfig.reset_to_defaults()

    def test_disable_metrics_skips_meter_setup(self):
        """disable_metrics=True should not initialize the meter provider."""
        openlit.init(disable_metrics=True)
        assert openlit.OpenlitConfig.disable_metrics is True
        assert openlit.OpenlitConfig.metrics_dict is None
        assert metrics_module.METER_SET is False

    def test_disable_metrics_false_sets_up_meter(self):
        """disable_metrics=False should initialize metrics as usual."""
        openlit.init(disable_metrics=False)
        assert openlit.OpenlitConfig.disable_metrics is False
        assert openlit.OpenlitConfig.metrics_dict is not None
        assert metrics_module.METER_SET is True
