# pylint: disable=duplicate-code, no-name-in-module
"""
This module contains tests for Ollama functionality using the Ollama Python library.

Tests cover various API endpoints, including embeddings, chat and generate.
These tests validate integration with OpenLIT.

Environment Variables:
    - OLLAMA_HOST: Ollama server host.

Note: Ensure the environment is properly configured for Ollama access and OpenLIT monitoring
prior to running these tests.
"""

import os

import pytest
from ollama import Client, AsyncClient, EmbedResponse, ChatResponse, GenerateResponse, Message
import openlit

# Initialize Ollama
EMBEDDING_MODEL_NAME = 'nomic-embed-text'
LLM_MODEL_NAME = 'gemma2:2b'
DEFAULT_OLLAMA_HOST = "http://localhost:11434"

sync_client = Client(host=os.getenv("OLLAMA_HOST") or DEFAULT_OLLAMA_HOST)
async_client = AsyncClient(host=os.getenv("OLLAMA_HOST") or DEFAULT_OLLAMA_HOST)

sync_client.pull(EMBEDDING_MODEL_NAME)
sync_client.pull(LLM_MODEL_NAME)

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-ollama-test")


def test_sync_ollama_embeddings():
    """
    Tests synchronous embedding creation with the 'nomic-embed-text' model.

    Raises:
        AssertionError: If the embedding response object is not as expected.
    """

    response = sync_client.embed(
        model=EMBEDDING_MODEL_NAME,
        input=["Embed this sentence.", "OpenTelemetry LLM Observability"],
    )
    assert isinstance(response, EmbedResponse)
    assert isinstance(response.embeddings, list)


@pytest.mark.asyncio
async def test_async_ollama_embeddings():
    """
    Tests asynchronous embedding creation with the 'nomic-embed-text' model.

    Raises:
        AssertionError: If the embedding response object is not as expected.
    """

    response = await async_client.embed(
        model=EMBEDDING_MODEL_NAME,
        input=["Embed this sentence.", "OpenTelemetry LLM Observability"],
    )
    assert isinstance(response, EmbedResponse)
    assert isinstance(response.embeddings, list)


def test_sync_ollama_chat():
    """
    Tests synchronous Chat Completions with the 'gemma2:2b' model.

    Raises:
        AssertionError: If the Chat Completions response object is not as expected.
    """

    try:
        chat_completions_resp = sync_client.chat(
            messages=[
                {
                    "role": "user",
                    "content": "What is LLM Observability?"
                }
            ],
            model=LLM_MODEL_NAME,
        )
        assert isinstance(chat_completions_resp, ChatResponse)
        assert isinstance(chat_completions_resp.message, Message)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


@pytest.mark.asyncio
async def test_async_ollama_chat():
    """
    Tests asynchronous Chat Completions with the 'gemma2:2b' model.

    Raises:
        AssertionError: If the Chat Completions response object is not as expected.
    """

    try:
        chat_completions_resp = await async_client.chat(
            messages=[
                {
                    "role": "user",
                    "content": "What is LLM Observability?",
                }
            ],
            model=LLM_MODEL_NAME,
            keep_alive=False
        )
        assert isinstance(chat_completions_resp, ChatResponse)
        assert isinstance(chat_completions_resp.message, Message)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


def test_sync_ollama_generate():
    """
    Tests synchronous Text Completions with the 'gemma2:2b' model.

    Raises:
        AssertionError: If the Text Completions response object is not as expected.
    """

    try:
        chat_completions_resp = sync_client.generate(
            prompt="What is LLM Observability?",
            model=LLM_MODEL_NAME,
        )
        assert isinstance(chat_completions_resp, GenerateResponse)
        assert isinstance(chat_completions_resp.response, str)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise


@pytest.mark.asyncio
async def test_async_ollama_generate():
    """
    Tests asynchronous Text Completions with the 'gemma2:2b' model.

    Raises:
        AssertionError: If the Text Completions response object is not as expected.
    """

    try:
        chat_completions_resp = await async_client.generate(
            prompt="What is LLM Observability?",
            model=LLM_MODEL_NAME,
            keep_alive=False
        )
        assert isinstance(chat_completions_resp, GenerateResponse)
        assert isinstance(chat_completions_resp.response, str)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise
