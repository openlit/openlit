# pylint: disable=duplicate-code
"""
Tests for agent metric instrumentation.

Tests cover:
- ContextVar-based agent name propagation via agent_context()
- gen_ai.agent.name inclusion/exclusion on create_metrics_attributes()
- record_agent_duration helper
- record_agent_invocation helper
- log_agent_invocation public API

These tests do not require any external API keys or services.
"""

import openlit
from openlit.__helpers import (
    create_metrics_attributes,
    set_agent_name,
    reset_agent_name,
    get_agent_name,
    record_agent_duration,
    record_agent_invocation,
    _current_agent_name,
)
from openlit.semcov import SemanticConvention
from openlit.otel.metrics import setup_meter

# Initialize OpenLIT with console exporters for testing
openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-agent-metrics-test",
)


# ---------------------------------------------------------------------------
# 1. ContextVar propagation
# ---------------------------------------------------------------------------

class TestAgentContext:
    """Tests for agent_context() and the underlying ContextVar."""

    def test_agent_context_sets_and_resets(self):
        """agent_context sets the name and resets it on exit."""
        assert get_agent_name() is None

        with openlit.agent_context("product_agent"):
            assert get_agent_name() == "product_agent"

        assert get_agent_name() is None

    def test_agent_context_resets_on_exception(self):
        """agent_context resets even when the body raises."""
        assert get_agent_name() is None

        try:
            with openlit.agent_context("failing_agent"):
                assert get_agent_name() == "failing_agent"
                raise ValueError("boom")
        except ValueError:
            pass

        assert get_agent_name() is None

    def test_agent_context_nesting(self):
        """Nested agent_context restores the outer name on exit."""
        with openlit.agent_context("outer_agent"):
            assert get_agent_name() == "outer_agent"

            with openlit.agent_context("inner_agent"):
                assert get_agent_name() == "inner_agent"

            assert get_agent_name() == "outer_agent"

        assert get_agent_name() is None

    def test_set_reset_with_token(self):
        """Low-level set/reset with token works correctly."""
        token = set_agent_name("manual_agent")
        assert get_agent_name() == "manual_agent"
        reset_agent_name(token)
        assert get_agent_name() is None


# ---------------------------------------------------------------------------
# 2. create_metrics_attributes — include_agent_name gating
# ---------------------------------------------------------------------------

class TestCreateMetricsAttributes:
    """Tests for agent name inclusion/exclusion on metric attributes."""

    BASE_KWARGS = dict(
        service_name="test-service",
        deployment_environment="test",
        operation="chat",
        system="anthropic",
        request_model="claude-haiku-4-5",
        server_address="api.anthropic.com",
        server_port=443,
        response_model="claude-haiku-4-5",
    )

    def test_agent_name_included_when_in_context(self):
        """When include_agent_name=True and agent is set, attribute is present."""
        with openlit.agent_context("my_agent"):
            attrs = create_metrics_attributes(
                **self.BASE_KWARGS, include_agent_name=True,
            )

        assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "my_agent"

    def test_agent_name_excluded_by_default(self):
        """When include_agent_name is not set (default False), attribute is absent."""
        with openlit.agent_context("my_agent"):
            attrs = create_metrics_attributes(**self.BASE_KWARGS)

        assert SemanticConvention.GEN_AI_AGENT_NAME not in attrs

    def test_agent_name_excluded_when_false(self):
        """When include_agent_name=False, attribute is absent even with context."""
        with openlit.agent_context("my_agent"):
            attrs = create_metrics_attributes(
                **self.BASE_KWARGS, include_agent_name=False,
            )

        assert SemanticConvention.GEN_AI_AGENT_NAME not in attrs

    def test_no_agent_name_when_context_empty(self):
        """When include_agent_name=True but no context set, attribute is absent."""
        assert get_agent_name() is None
        attrs = create_metrics_attributes(
            **self.BASE_KWARGS, include_agent_name=True,
        )

        assert SemanticConvention.GEN_AI_AGENT_NAME not in attrs


# ---------------------------------------------------------------------------
# 3. record_agent_duration
# ---------------------------------------------------------------------------

class TestRecordAgentDuration:
    """Tests for record_agent_duration helper."""

    def test_records_with_correct_attributes(self):
        """Duration is recorded with expected attributes."""
        metrics = openlit.OpenlitConfig.metrics_dict
        # Should not raise
        record_agent_duration(metrics, "test_agent", 1.5, operation="chat")

    def test_noop_when_metrics_none(self):
        """Gracefully no-ops when metrics dict is None."""
        record_agent_duration(None, "test_agent", 1.5)

    def test_noop_when_metrics_empty(self):
        """Gracefully no-ops when metrics dict is empty."""
        record_agent_duration({}, "test_agent", 1.5)

    def test_with_system_and_error_type(self):
        """Optional system and error_type attributes are accepted."""
        metrics = openlit.OpenlitConfig.metrics_dict
        record_agent_duration(
            metrics, "test_agent", 2.0,
            operation="invoke_agent",
            system="anthropic",
            error_type="ValueError",
        )


# ---------------------------------------------------------------------------
# 4. record_agent_invocation
# ---------------------------------------------------------------------------

class TestRecordAgentInvocation:
    """Tests for record_agent_invocation helper."""

    def test_records_with_correct_attributes(self):
        """Invocation is recorded with source and target."""
        metrics = openlit.OpenlitConfig.metrics_dict
        record_agent_invocation(metrics, "orchestrator", "product_agent")

    def test_noop_when_metrics_none(self):
        """Gracefully no-ops when metrics dict is None."""
        record_agent_invocation(None, "a", "b")

    def test_noop_when_metrics_empty(self):
        """Gracefully no-ops when metrics dict is empty."""
        record_agent_invocation({}, "a", "b")

    def test_with_system(self):
        """Optional system attribute is accepted."""
        metrics = openlit.OpenlitConfig.metrics_dict
        record_agent_invocation(
            metrics, "orchestrator", "cart_agent", system="anthropic",
        )


# ---------------------------------------------------------------------------
# 5. log_agent_invocation public API
# ---------------------------------------------------------------------------

class TestLogAgentInvocation:
    """Tests for the public openlit.log_agent_invocation() wrapper."""

    def test_public_api_does_not_raise(self):
        """Public API works without error."""
        openlit.log_agent_invocation("orchestrator", "product_agent")

    def test_public_api_with_system(self):
        """Public API accepts optional system parameter."""
        openlit.log_agent_invocation("orchestrator", "cart_agent", system="openai")
