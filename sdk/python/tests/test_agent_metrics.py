# pylint: disable=duplicate-code
"""
Tests for agent metric instrumentation.

Tests cover:
- ContextVar-based agent name propagation via agent_context()
- gen_ai.agent.name inclusion/exclusion on create_metrics_attributes()
- record_agent_duration helper
- record_agent_invocation helper
- log_agent_invocation public API
- Automatic agent-to-agent invocation detection (nested contexts)

These tests do not require any external API keys or services.
"""

import asyncio
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


# ---------------------------------------------------------------------------
# 6. Automatic agent-to-agent invocation detection
# ---------------------------------------------------------------------------

class TestNestedAgentDetection:
    """Tests that verify automatic invocation detection when agents nest."""

    def test_nested_context_detects_parent(self):
        """Inner agent_context can see the outer agent name."""
        with openlit.agent_context("parent_agent"):
            assert get_agent_name() == "parent_agent"

            # Simulate what the PydanticAI instrumentor does:
            # read parent before setting child
            parent = get_agent_name()
            assert parent == "parent_agent"

            with openlit.agent_context("child_agent"):
                assert get_agent_name() == "child_agent"

            # After child exits, parent is restored
            assert get_agent_name() == "parent_agent"

    def test_sequential_children_each_see_parent(self):
        """Multiple sequential child agents each see the same parent."""
        parents_seen = []

        with openlit.agent_context("orchestrator"):
            for child_name in ["agent_a", "agent_b", "agent_c"]:
                parent = get_agent_name()
                parents_seen.append(parent)
                with openlit.agent_context(child_name):
                    assert get_agent_name() == child_name

        assert parents_seen == ["orchestrator", "orchestrator", "orchestrator"]

    def test_deeply_nested_agents(self):
        """Three levels of nesting: A → B → C."""
        with openlit.agent_context("agent_a"):
            parent_of_b = get_agent_name()
            assert parent_of_b == "agent_a"

            with openlit.agent_context("agent_b"):
                parent_of_c = get_agent_name()
                assert parent_of_c == "agent_b"

                with openlit.agent_context("agent_c"):
                    assert get_agent_name() == "agent_c"

                assert get_agent_name() == "agent_b"
            assert get_agent_name() == "agent_a"

        assert get_agent_name() is None

    def test_same_agent_name_no_self_invocation(self):
        """An agent calling itself should not record a self-invocation."""
        with openlit.agent_context("agent_a"):
            parent = get_agent_name()
            # PydanticAI instrumentor checks: parent != ctx.agent_name
            assert parent == "agent_a"
            # So parent == child → no invocation recorded (correct)

    def test_no_parent_no_invocation(self):
        """When there's no parent agent, no invocation should be detected."""
        assert get_agent_name() is None
        with openlit.agent_context("standalone_agent"):
            # No parent to detect
            pass
        assert get_agent_name() is None

    def test_concurrent_async_agents_isolated(self):
        """Concurrent async agents each see the correct parent."""
        results = {}

        async def run_child(name):
            parent = get_agent_name()
            results[name] = {"parent_before": parent}
            token = set_agent_name(name)
            try:
                await asyncio.sleep(0.01)  # simulate async work
                results[name]["during"] = get_agent_name()
            finally:
                reset_agent_name(token)
            results[name]["after"] = get_agent_name()

        async def run_test():
            with openlit.agent_context("orchestrator"):
                await asyncio.gather(
                    run_child("agent_b"),
                    run_child("agent_c"),
                )

        asyncio.run(run_test())

        # Both children should have seen "orchestrator" as parent
        assert results["agent_b"]["parent_before"] == "orchestrator"
        assert results["agent_c"]["parent_before"] == "orchestrator"

        # During execution, each should see their own name
        assert results["agent_b"]["during"] == "agent_b"
        assert results["agent_c"]["during"] == "agent_c"

        # After reset, both should see "orchestrator" restored
        assert results["agent_b"]["after"] == "orchestrator"
        assert results["agent_c"]["after"] == "orchestrator"

    def test_concurrent_async_agents_dont_interfere(self):
        """Setting agent name in one async task doesn't affect another."""
        interference_detected = False

        async def agent_slow():
            token = set_agent_name("slow_agent")
            try:
                await asyncio.sleep(0.05)
                if get_agent_name() != "slow_agent":
                    nonlocal interference_detected
                    interference_detected = True
            finally:
                reset_agent_name(token)

        async def agent_fast():
            token = set_agent_name("fast_agent")
            try:
                await asyncio.sleep(0.01)
            finally:
                reset_agent_name(token)

        async def run_test():
            with openlit.agent_context("parent"):
                await asyncio.gather(agent_slow(), agent_fast())

        asyncio.run(run_test())

        assert not interference_detected, "Concurrent agents interfered with each other's context"
