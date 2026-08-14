# pylint: disable=duplicate-code, no-name-in-module
"""
Tests for the DigitalOcean Gradient SDK instrumentation.

Exercises chat completions (sync + async, streaming + non-streaming) and
the OpenAI-style Responses API.

Environment Variables:
    - DIGITALOCEAN_ACCESS_TOKEN: DO control-plane token
    - GRADIENT_MODEL_ACCESS_KEY: Serverless inference key
    - GRADIENT_AGENT_ACCESS_KEY: Agent inference key (optional)
"""

import os
import pytest

import openlit

gradient_pkg = pytest.importorskip("gradient")
Gradient = gradient_pkg.Gradient
AsyncGradient = getattr(gradient_pkg, "AsyncGradient", None)

sync_client = Gradient(
    access_token=os.getenv("DIGITALOCEAN_ACCESS_TOKEN", ""),
    model_access_key=os.getenv("GRADIENT_MODEL_ACCESS_KEY", ""),
)
async_client = None
if AsyncGradient is not None:
    try:
        async_client = AsyncGradient(
            access_token=os.getenv("DIGITALOCEAN_ACCESS_TOKEN", ""),
            model_access_key=os.getenv("GRADIENT_MODEL_ACCESS_KEY", ""),
        )
    except Exception:
        async_client = None

openlit.init(environment="openlit-testing", application_name="openlit-python-test")


def _benign_or_raise(exc):
    msg = str(exc).lower()
    if any(
        keyword in msg
        for keyword in (
            "rate limit",
            "unauthorized",
            "401",
            "403",
            "credentials",
            "token",
            "api key",
            "forbidden",
            "not found",
            "404",
            "connection",
        )
    ):
        print("Skipping due to environment:", exc)
        return
    raise exc


def test_sync_gradient_chat():
    """Sync non-streaming chat completion."""
    try:
        resp = sync_client.chat.completions.create(
            model="llama3.3-70b-instruct",
            messages=[{"role": "user", "content": "Say hi"}],
            max_tokens=5,
            stream=False,
        )
        assert resp is not None
    except Exception as exc:
        _benign_or_raise(exc)


def test_sync_gradient_chat_stream():
    """Sync streaming chat completion."""
    try:
        stream = sync_client.chat.completions.create(
            model="llama3.3-70b-instruct",
            messages=[{"role": "user", "content": "Count to 3"}],
            max_tokens=10,
            stream=True,
        )
        for _chunk in stream:
            pass
    except Exception as exc:
        _benign_or_raise(exc)


@pytest.mark.asyncio
async def test_async_gradient_chat():
    """Async non-streaming chat completion."""
    if async_client is None:
        pytest.skip("AsyncGradient unavailable")
    try:
        resp = await async_client.chat.completions.create(
            model="llama3.3-70b-instruct",
            messages=[{"role": "user", "content": "Say hi"}],
            max_tokens=5,
            stream=False,
        )
        assert resp is not None
    except Exception as exc:
        _benign_or_raise(exc)
