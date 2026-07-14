"""
Regression tests for the "Failed to detach context" / ValueError raised when
an OTel context Token created in one asyncio Task/Context is detached from a
different one - e.g. a streaming Anthropic response abandoned mid-iteration
whose `__aexit__` is later driven by asyncio's asyncgen GC finalizer in a
fresh Task. See openlit/__helpers.py's `safe_detach` and
TracedAsyncMessageStreamManager in
openlit/instrumentation/anthropic/async_anthropic.py.
"""

import asyncio
import contextvars

import pytest
from opentelemetry import trace as trace_api, context as context_api

from openlit.__helpers import safe_detach
from openlit.instrumentation.anthropic.async_anthropic import async_messages_stream


def test_safe_detach_swallows_cross_context_token():
    """Without an attaching_task hint, a bare Context mismatch must not raise."""
    token = context_api.attach(context_api.set_value("k", "v"))

    result = {}

    def detach_in_foreign_context():
        try:
            safe_detach(token)
            result["raised"] = False
        except ValueError:
            result["raised"] = True

    contextvars.Context().run(detach_in_foreign_context)

    assert result["raised"] is False


def test_safe_detach_same_task_still_detaches():
    """The common, well-behaved case must be unaffected: same Task -> real detach happens."""

    async def main():
        before = context_api.get_value("k")
        token = context_api.attach(context_api.set_value("k", "v"))
        assert context_api.get_value("k") == "v"

        safe_detach(token, asyncio.current_task())

        assert context_api.get_value("k") == before

    asyncio.run(main())


def test_safe_detach_skips_foreign_task_without_attempting_detach():
    """
    Foreign Task -> the mismatch is detected up front and detach is skipped
    entirely (not attempted-then-caught). This is the deterministic fix:
    it must behave identically whether or not context_api.detach() would
    have raised.
    """

    async def main():
        token_holder = {}

        async def attach_only():
            token_holder["token"] = context_api.attach(
                context_api.set_value("span", "abandoned-stream")
            )
            token_holder["task"] = asyncio.current_task()

        await asyncio.create_task(attach_only())

        # Runs in main()'s task, which never attached anything - mirrors the
        # asyncgen finalizer Task in the real bug.
        safe_detach(token_holder["token"], token_holder["task"])

    asyncio.run(main())


def _make_stream_manager():
    """Builds a TracedAsyncMessageStreamManager wired to a no-op fake Anthropic stream."""
    tracer = trace_api.get_tracer(__name__)

    class FakeAnthropicStream:
        """Immediately-exhausted stand-in for the real Anthropic stream object."""

        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

    class FakeOriginalManager:
        """Stand-in for Anthropic's own (un-instrumented) stream context manager."""

        async def __aenter__(self):
            return FakeAnthropicStream()

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            return False

    def fake_wrapped(*args, **kwargs):
        return FakeOriginalManager()

    wrapper = async_messages_stream(
        version="test",
        environment="test",
        application_name="test",
        tracer=tracer,
        pricing_info={},
        capture_message_content=False,
        metrics=None,
        disable_metrics=True,
    )

    return wrapper(fake_wrapped, None, (), {"model": "claude-3-5-sonnet-latest"})


@pytest.mark.asyncio
async def test_stream_manager_aexit_in_foreign_task_does_not_raise():
    """
    End-to-end: enter the manager in one Task, exit it (as the asyncgen
    finalizer would) from a different Task. Must not raise, matching the
    abandoned-stream production traceback this fix addresses.
    """
    manager = _make_stream_manager()

    # pylint: disable=unnecessary-dunder-call
    # Entering/exiting manually (not via `async with`) so each half can run in
    # a different Task, mirroring the asyncgen finalizer split in production.
    await manager.__aenter__()

    async def exit_from_foreign_task():
        await manager.__aexit__(None, None, None)

    await asyncio.create_task(exit_from_foreign_task())
