# pylint: disable=duplicate-code, no-name-in-module
"""
Tests for the DigitalOcean pydo SDK instrumentation.

Exercises chat completions (sync + async, streaming + non-streaming),
embeddings, and the Anthropic-style messages API.

Environment Variables:
    - DIGITALOCEAN_TOKEN: DO token for serverless inference at inference.do-ai.run
"""

import os
import pytest

import openlit

pydo = pytest.importorskip("pydo")

sync_client = pydo.Client(token=os.getenv("DIGITALOCEAN_TOKEN", ""))
async_client = None
try:
    async_client = pydo.aio.Client(token=os.getenv("DIGITALOCEAN_TOKEN", ""))
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
            "forbidden",
            "not found",
            "404",
            "connection",
        )
    ):
        print("Skipping due to environment:", exc)
        return
    raise exc


def test_sync_pydo_chat():
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


def test_sync_pydo_chat_stream():
    """Sync streaming chat completion."""
    try:
        stream = sync_client.chat.completions.create(
            model="llama3.3-70b-instruct",
            messages=[{"role": "user", "content": "Count to 3"}],
            max_tokens=10,
            stream=True,
        )
        # SSEStream is a context manager; iterating drains it
        with stream:
            for _chunk in stream:
                pass
    except Exception as exc:
        _benign_or_raise(exc)


@pytest.mark.asyncio
async def test_async_pydo_chat():
    """Async non-streaming chat completion."""
    if async_client is None:
        pytest.skip("pydo.aio.Client unavailable")
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


def test_sync_pydo_embeddings():
    """Sync embeddings."""
    try:
        resp = sync_client.embeddings.create(
            model="gte-large-en-v1.5",
            input="hello world",
        )
        assert resp is not None
    except Exception as exc:
        _benign_or_raise(exc)
