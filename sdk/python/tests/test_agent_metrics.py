# pylint: disable=duplicate-code
"""
Tests for agent metric instrumentation.

Tests cover:
- ContextVar-based agent name propagation via agent_context()
- gen_ai.agent.name inclusion/exclusion on create_metrics_attributes()
- record_agent_duration helper
- record_agent_invocation helper
- log_agent_invocation public API
- record_agent_tool_error helper
- log_agent_tool_error public API
- Automatic agent-to-agent invocation detection (nested contexts)

These tests do not require any external API keys or services.
"""

import asyncio
from unittest.mock import MagicMock
import openlit
from openlit.__helpers import (
    record_completion_metrics,
    create_metrics_attributes,
    set_agent_name,
    reset_agent_name,
    get_agent_name,
    record_agent_duration,
    record_agent_invocation,
    record_agent_tool_error,
)
from openlit.semcov import SemanticConvention

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

        with openlit.agent_context("target_agent"):
            assert get_agent_name() == "target_agent"

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

    BASE_KWARGS = {
        "service_name": "test-service",
        "deployment_environment": "test",
        "operation": "chat",
        "system": "anthropic",
        "request_model": "claude-haiku-4-5",
        "server_address": "api.anthropic.com",
        "server_port": 443,
        "response_model": "claude-haiku-4-5",
    }

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

    def test_record_completion_metrics_includes_agent_name(self):
        """record_completion_metrics tags all metrics with agent name when in context."""
        fake_duration = MagicMock()
        fake_tokens = MagicMock()
        fake_cost = MagicMock()
        fake_ttft = MagicMock()
        fake_tbt = MagicMock()
        fake_server_duration = MagicMock()
        metrics = {
            "genai_client_operation_duration": fake_duration,
            "genai_client_usage_tokens": fake_tokens,
            "genai_cost": fake_cost,
            "genai_server_ttft": fake_ttft,
            "genai_server_tbt": fake_tbt,
            "genai_server_request_duration": fake_server_duration,
        }

        with openlit.agent_context("my_agent"):
            record_completion_metrics(
                metrics,
                gen_ai_operation="chat",
                GEN_AI_PROVIDER_NAME="anthropic",
                server_address="api.anthropic.com",
                server_port=443,
                request_model="claude-haiku-4-5",
                response_model="claude-haiku-4-5",
                environment="test",
                application_name="test-app",
                start_time=0.0,
                end_time=1.5,
                input_tokens=100,
                output_tokens=50,
                cost=0.001,
                tbt=0.01,
                ttft=0.5,
            )

        # Duration metric should have agent name
        _, duration_attrs = fake_duration.record.call_args[0]
        assert duration_attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "my_agent"

        # Token metrics should have agent name
        token_calls = fake_tokens.record.call_args_list
        for call in token_calls:
            _, token_attrs = call[0]
            assert token_attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "my_agent"

    def test_record_completion_metrics_excludes_agent_name_without_context(self):
        """record_completion_metrics omits agent name when no context is set."""
        fake_duration = MagicMock()
        metrics = {
            "genai_client_operation_duration": fake_duration,
            "genai_client_usage_tokens": MagicMock(),
            "genai_cost": MagicMock(),
            "genai_server_ttft": MagicMock(),
            "genai_server_tbt": MagicMock(),
            "genai_server_request_duration": MagicMock(),
        }

        record_completion_metrics(
            metrics,
            gen_ai_operation="chat",
            GEN_AI_PROVIDER_NAME="anthropic",
            server_address="api.anthropic.com",
            server_port=443,
            request_model="claude-haiku-4-5",
            response_model="claude-haiku-4-5",
            environment="test",
            application_name="test-app",
            start_time=0.0,
            end_time=1.5,
            input_tokens=100,
            output_tokens=50,
            cost=0.001,
            tbt=None,
            ttft=None,
        )

        _, duration_attrs = fake_duration.record.call_args[0]
        assert SemanticConvention.GEN_AI_AGENT_NAME not in duration_attrs


# ---------------------------------------------------------------------------
# 3. record_agent_duration
# ---------------------------------------------------------------------------

class TestRecordAgentDuration:
    """Tests for record_agent_duration helper."""

    def test_records_with_correct_attributes(self):
        """Duration is recorded with the expected agent name and operation."""
        fake_histogram = MagicMock()
        metrics = {"genai_agent_operation_duration": fake_histogram}
        record_agent_duration(metrics, "test_agent", 1.5, operation="chat")

        fake_histogram.record.assert_called_once()
        value, attrs = fake_histogram.record.call_args[0]
        assert value == 1.5
        assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "test_agent"
        assert attrs[SemanticConvention.GEN_AI_OPERATION] == "chat"
        assert SemanticConvention.GEN_AI_PROVIDER_NAME not in attrs

    def test_records_with_system(self):
        """System attribute is included when provided."""
        fake_histogram = MagicMock()
        metrics = {"genai_agent_operation_duration": fake_histogram}
        record_agent_duration(
            metrics, "test_agent", 2.0,
            operation="invoke_agent", system="anthropic",
        )

        _, attrs = fake_histogram.record.call_args[0]
        assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "anthropic"

    def test_records_with_error_type(self):
        """Error type attribute is included when provided."""
        fake_histogram = MagicMock()
        metrics = {"genai_agent_operation_duration": fake_histogram}
        record_agent_duration(
            metrics, "test_agent", 0.5, error_type="ValueError",
        )

        _, attrs = fake_histogram.record.call_args[0]
        assert attrs[SemanticConvention.ERROR_TYPE] == "ValueError"

    def test_noop_when_metrics_none(self):
        """Gracefully no-ops when metrics dict is None."""
        record_agent_duration(None, "test_agent", 1.5)

    def test_noop_when_metrics_empty(self):
        """Gracefully no-ops when metrics dict is empty."""
        record_agent_duration({}, "test_agent", 1.5)


# ---------------------------------------------------------------------------
# 4. record_agent_invocation
# ---------------------------------------------------------------------------

class TestRecordAgentInvocation:
    """Tests for record_agent_invocation helper."""

    def test_records_with_correct_attributes(self):
        """Invocation is recorded with source and target attributes."""
        fake_counter = MagicMock()
        metrics = {"genai_agent_invocations": fake_counter}
        record_agent_invocation(metrics, "dispatcher", "target_agent")

        fake_counter.add.assert_called_once()
        value, attrs = fake_counter.add.call_args[0]
        assert value == 1
        assert attrs[SemanticConvention.GEN_AI_AGENT_SOURCE] == "dispatcher"
        assert attrs[SemanticConvention.GEN_AI_AGENT_TARGET] == "target_agent"
        assert SemanticConvention.GEN_AI_PROVIDER_NAME not in attrs

    def test_records_with_system(self):
        """System attribute is included when provided."""
        fake_counter = MagicMock()
        metrics = {"genai_agent_invocations": fake_counter}
        record_agent_invocation(
            metrics, "dispatcher", "another_agent", system="anthropic",
        )

        _, attrs = fake_counter.add.call_args[0]
        assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "anthropic"

    def test_noop_when_metrics_none(self):
        """Gracefully no-ops when metrics dict is None."""
        record_agent_invocation(None, "a", "b")

    def test_noop_when_metrics_empty(self):
        """Gracefully no-ops when metrics dict is empty."""
        record_agent_invocation({}, "a", "b")


# ---------------------------------------------------------------------------
# 5. log_agent_invocation public API
# ---------------------------------------------------------------------------

class TestLogAgentInvocation:
    """Tests for the public openlit.log_agent_invocation() wrapper."""

    def test_delegates_to_counter(self):
        """Public API records to the genai_agent_invocations counter."""
        fake_counter = MagicMock()
        original = openlit.OpenlitConfig.metrics_dict
        openlit.OpenlitConfig.metrics_dict = {"genai_agent_invocations": fake_counter}
        try:
            openlit.log_agent_invocation("dispatcher", "target_agent")

            fake_counter.add.assert_called_once()
            value, attrs = fake_counter.add.call_args[0]
            assert value == 1
            assert attrs[SemanticConvention.GEN_AI_AGENT_SOURCE] == "dispatcher"
            assert attrs[SemanticConvention.GEN_AI_AGENT_TARGET] == "target_agent"
        finally:
            openlit.OpenlitConfig.metrics_dict = original

    def test_delegates_with_system(self):
        """Public API passes system through to the counter."""
        fake_counter = MagicMock()
        original = openlit.OpenlitConfig.metrics_dict
        openlit.OpenlitConfig.metrics_dict = {"genai_agent_invocations": fake_counter}
        try:
            openlit.log_agent_invocation("dispatcher", "another_agent", system="openai")

            _, attrs = fake_counter.add.call_args[0]
            assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "openai"
        finally:
            openlit.OpenlitConfig.metrics_dict = original

    def test_noop_when_no_metrics(self):
        """Does not raise when metrics are not initialized."""
        original = openlit.OpenlitConfig.metrics_dict
        openlit.OpenlitConfig.metrics_dict = {}
        try:
            openlit.log_agent_invocation("a", "b")
        finally:
            openlit.OpenlitConfig.metrics_dict = original


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

        with openlit.agent_context("dispatcher"):
            for child_name in ["agent_a", "agent_b", "agent_c"]:
                parent = get_agent_name()
                parents_seen.append(parent)
                with openlit.agent_context(child_name):
                    assert get_agent_name() == child_name

        assert parents_seen == ["dispatcher", "dispatcher", "dispatcher"]

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
            with openlit.agent_context("dispatcher"):
                await asyncio.gather(
                    run_child("agent_b"),
                    run_child("agent_c"),
                )

        asyncio.run(run_test())

        # Both children should have seen "dispatcher" as parent
        assert results["agent_b"]["parent_before"] == "dispatcher"
        assert results["agent_c"]["parent_before"] == "dispatcher"

        # During execution, each should see their own name
        assert results["agent_b"]["during"] == "agent_b"
        assert results["agent_c"]["during"] == "agent_c"

        # After reset, both should see "dispatcher" restored
        assert results["agent_b"]["after"] == "dispatcher"
        assert results["agent_c"]["after"] == "dispatcher"

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


# ---------------------------------------------------------------------------
# 7. record_agent_tool_error
# ---------------------------------------------------------------------------

class TestRecordAgentToolError:
    """Tests for record_agent_tool_error helper."""

    def test_records_with_correct_attributes(self):
        """Tool error is recorded with agent name and tool name."""
        fake_counter = MagicMock()
        metrics = {"genai_agent_tool_errors": fake_counter}
        record_agent_tool_error(metrics, "cart_agent", "add_to_cart")

        fake_counter.add.assert_called_once()
        value, attrs = fake_counter.add.call_args[0]
        assert value == 1
        assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "cart_agent"
        assert attrs["gen_ai.tool.name"] == "add_to_cart"
        assert SemanticConvention.GEN_AI_PROVIDER_NAME not in attrs
        assert SemanticConvention.GEN_AI_REQUEST_MODEL not in attrs

    def test_records_with_system_and_model(self):
        """System and model attributes are included when provided."""
        fake_counter = MagicMock()
        metrics = {"genai_agent_tool_errors": fake_counter}
        record_agent_tool_error(
            metrics, "cart_agent", "add_to_cart",
            system="anthropic", model="claude-haiku-4-5",
        )

        _, attrs = fake_counter.add.call_args[0]
        assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "anthropic"
        assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "claude-haiku-4-5"

    def test_records_with_system_only(self):
        """Works with system but no model."""
        fake_counter = MagicMock()
        metrics = {"genai_agent_tool_errors": fake_counter}
        record_agent_tool_error(
            metrics, "product_agent", "search_products", system="openai",
        )

        _, attrs = fake_counter.add.call_args[0]
        assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "openai"
        assert SemanticConvention.GEN_AI_REQUEST_MODEL not in attrs

    def test_noop_when_metrics_none(self):
        """Gracefully no-ops when metrics dict is None."""
        record_agent_tool_error(None, "cart_agent", "add_to_cart")

    def test_noop_when_metrics_empty(self):
        """Gracefully no-ops when metrics dict is empty."""
        record_agent_tool_error({}, "cart_agent", "add_to_cart")


# ---------------------------------------------------------------------------
# 8. log_agent_tool_error public API
# ---------------------------------------------------------------------------

class TestLogAgentToolError:
    """Tests for the public openlit.log_agent_tool_error() wrapper."""

    def test_delegates_to_counter(self):
        """Public API records to the genai_agent_tool_errors counter."""
        fake_counter = MagicMock()
        original = openlit.OpenlitConfig.metrics_dict
        openlit.OpenlitConfig.metrics_dict = {"genai_agent_tool_errors": fake_counter}
        try:
            openlit.log_agent_tool_error("cart_agent", "add_to_cart")

            fake_counter.add.assert_called_once()
            value, attrs = fake_counter.add.call_args[0]
            assert value == 1
            assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "cart_agent"
            assert attrs["gen_ai.tool.name"] == "add_to_cart"
        finally:
            openlit.OpenlitConfig.metrics_dict = original

    def test_delegates_with_system_and_model(self):
        """Public API passes system and model through to the counter."""
        fake_counter = MagicMock()
        original = openlit.OpenlitConfig.metrics_dict
        openlit.OpenlitConfig.metrics_dict = {"genai_agent_tool_errors": fake_counter}
        try:
            openlit.log_agent_tool_error(
                "cart_agent", "get_cart",
                system="anthropic", model="claude-haiku-4-5",
            )

            _, attrs = fake_counter.add.call_args[0]
            assert attrs[SemanticConvention.GEN_AI_PROVIDER_NAME] == "anthropic"
            assert attrs[SemanticConvention.GEN_AI_REQUEST_MODEL] == "claude-haiku-4-5"
        finally:
            openlit.OpenlitConfig.metrics_dict = original

    def test_noop_when_no_metrics(self):
        """Does not raise when metrics are not initialized."""
        original = openlit.OpenlitConfig.metrics_dict
        openlit.OpenlitConfig.metrics_dict = {}
        try:
            openlit.log_agent_tool_error("cart_agent", "add_to_cart")
        finally:
            openlit.OpenlitConfig.metrics_dict = original


# ---------------------------------------------------------------------------
# 7. Agent error tracking on duration metric
# ---------------------------------------------------------------------------

class TestAgentErrorTracking:
    """Tests that agent errors are recorded on the duration histogram via error_type."""

    def test_duration_records_error_type_on_failure(self):
        """record_agent_duration includes error.type when provided."""
        fake_histogram = MagicMock()
        metrics = {"genai_agent_operation_duration": fake_histogram}
        record_agent_duration(
            metrics, "failing_agent", 0.8,
            operation="chat", error_type="ValueError",
        )

        fake_histogram.record.assert_called_once()
        value, attrs = fake_histogram.record.call_args[0]
        assert value == 0.8
        assert attrs[SemanticConvention.GEN_AI_AGENT_NAME] == "failing_agent"
        assert attrs[SemanticConvention.ERROR_TYPE] == "ValueError"

    def test_duration_no_error_type_on_success(self):
        """record_agent_duration omits error.type when not provided."""
        fake_histogram = MagicMock()
        metrics = {"genai_agent_operation_duration": fake_histogram}
        record_agent_duration(metrics, "good_agent", 1.2, operation="chat")

        _, attrs = fake_histogram.record.call_args[0]
        assert SemanticConvention.ERROR_TYPE not in attrs

    def test_error_type_none_omitted(self):
        """record_agent_duration omits error.type when explicitly None."""
        fake_histogram = MagicMock()
        metrics = {"genai_agent_operation_duration": fake_histogram}
        record_agent_duration(
            metrics, "agent", 1.0, error_type=None,
        )

        _, attrs = fake_histogram.record.call_args[0]
        assert SemanticConvention.ERROR_TYPE not in attrs

    def test_context_resets_after_error(self):
        """Agent context is cleaned up even when the agent raises."""
        assert get_agent_name() is None

        try:
            with openlit.agent_context("error_agent"):
                assert get_agent_name() == "error_agent"
                raise RuntimeError("agent failed")
        except RuntimeError:
            pass

        assert get_agent_name() is None
