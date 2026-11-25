"""Regression tests for context attributes on decorated async functions."""

import asyncio
import inspect

import pytest

from openlit import using_attributes
from openlit.__helpers import get_custom_attributes


def test_async_decorator_preserves_attributes_and_metadata():
    @using_attributes({"stage": "agent"})
    async def decorated(value):
        """A decorated coroutine."""
        assert get_custom_attributes() == {"stage": "agent"}
        await asyncio.sleep(0)
        assert get_custom_attributes() == {"stage": "agent"}
        return value

    async def run():
        with using_attributes({"stage": "caller"}):
            assert await decorated(42) == 42
            assert get_custom_attributes() == {"stage": "caller"}

    assert inspect.iscoroutinefunction(decorated)
    assert decorated.__name__ == "decorated"
    assert decorated.__doc__ == "A decorated coroutine."
    asyncio.run(run())


def test_async_decorator_restores_attributes_after_error():
    @using_attributes({"stage": "agent"})
    async def decorated():
        await asyncio.sleep(0)
        assert get_custom_attributes() == {"stage": "agent"}
        raise ValueError("failed")

    async def run():
        with using_attributes({"stage": "caller"}):
            with pytest.raises(ValueError, match="failed"):
                await decorated()
            assert get_custom_attributes() == {"stage": "caller"}

    asyncio.run(run())


def test_async_decorator_is_safe_for_overlapping_calls():
    both_running = None
    started = 0

    @using_attributes({"stage": "agent"})
    async def decorated():
        nonlocal started
        started += 1
        if started == 2:
            both_running.set()
        await both_running.wait()
        assert get_custom_attributes() == {"stage": "agent"}

    async def caller(label):
        with using_attributes({"stage": label}):
            await decorated()
            assert get_custom_attributes() == {"stage": label}

    async def run():
        nonlocal both_running
        both_running = asyncio.Event()
        await asyncio.gather(caller("first"), caller("second"))

    asyncio.run(run())


def test_sync_decorator_still_restores_attributes():
    @using_attributes({"stage": "agent"})
    def decorated():
        assert get_custom_attributes() == {"stage": "agent"}
        return 42

    with using_attributes({"stage": "caller"}):
        assert decorated() == 42
        assert get_custom_attributes() == {"stage": "caller"}


def test_async_decorator_restores_attributes_after_cancellation():
    @using_attributes({"stage": "agent"})
    async def decorated():
        assert get_custom_attributes() == {"stage": "agent"}
        raise asyncio.CancelledError()

    async def run():
        with using_attributes({"stage": "caller"}):
            with pytest.raises(asyncio.CancelledError):
                await decorated()
            assert get_custom_attributes() == {"stage": "caller"}

    asyncio.run(run())


@pytest.mark.parametrize("asynchronous", [False, True])
def test_subclass_with_required_constructor_state(asynchronous):
    class LabeledAttributes(using_attributes):
        def __init__(self, attributes, label):
            super().__init__(attributes)
            self.label = label

        def __enter__(self):
            assert self.label == "required"
            return super().__enter__()

    decorator = LabeledAttributes({"stage": "agent"}, "required")

    def check():
        assert get_custom_attributes() == {"stage": "agent"}
        return 42

    async def async_check():
        await asyncio.sleep(0)
        return check()

    target = decorator(async_check if asynchronous else check)
    with using_attributes({"stage": "caller"}):
        result = asyncio.run(target()) if asynchronous else target()
        assert result == 42
        assert get_custom_attributes() == {"stage": "caller"}
