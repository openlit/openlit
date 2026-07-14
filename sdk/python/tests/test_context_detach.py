"""
Regression test for the "Failed to detach context" / ValueError raised when an
OTel context Token created in one asyncio Task/Context is detached from a
different one (e.g. a streaming Anthropic response abandoned mid-iteration and
finalized by asyncio's GC hook in a foreign Task). See openlit/__helpers.py's
`safe_detach`.
"""

import asyncio
import contextvars

from opentelemetry import context as context_api

from openlit.__helpers import safe_detach


def test_safe_detach_swallows_cross_context_token():
    """A token detached outside its originating Context must not raise."""
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


def test_safe_detach_swallows_cross_task_token():
    """Mirrors the real bug: token attached in one asyncio Task, detached in another."""

    async def main():
        token_holder = {}

        async def attach_only():
            token_holder["token"] = context_api.attach(
                context_api.set_value("span", "abandoned-stream")
            )

        await asyncio.create_task(attach_only())

        raised = False
        try:
            safe_detach(token_holder["token"])
        except ValueError:
            raised = True

        assert raised is False

    asyncio.run(main())
