# pylint: disable=duplicate-code, no-name-in-module
"""
This module contains tests for Together functionality using the Together Python library.

Tests cover various API endpoints, including chat and embeddings. 
These tests validate integration with OpenLIT.

Environment Variables:
    - TOGETHER_API_KEY: Together API key for authentication.

Note: Ensure the environment is properly configured for Together access and OpenLIT monitoring
prior to running these tests.
"""

import pytest
from together import Together
import openlit

# Initialize synchronous Together client
sync_client = Together()

# Initialize asynchronous Together client
async_client = AsyncTogether()

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-python-testing", application_name="openlit-python-together-test")

def test_sync_together_chat():
    """
    Tests synchronous chat.

    Raises:
        AssertionError: If the response object is not as expected.
    """

    response =  sync_client.chat.completions.create(
        model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        messages=[
            {
                    "role": "user",
                    "content": "Hi"
            },
        ],
        max_tokens=1,
        stream=False,
    )
    assert message.model == 'meta-llama/Llama-3.3-70B-Instruct-Turbo'

def test_sync_together_image():
    """
    Tests synchronous image generate.

    Raises:
        AssertionError: If the response object is not as expected.
    """

    response = sync_client.images.generate(
        prompt="AI Observability dashboard",
        model="black-forest-labs/FLUX.1-dev",
        width=768,
        height=768,
        n=1,
    )

    assert message.model == 'black-forest-labs/FLUX.1-dev'

@pytest.mark.asyncio
async def test_async_together_chat():
    """
    Tests asynchronous chat.

    Raises:
        AssertionError: If the response object is not as expected.
    """

    response =  await async_client.chat.completions.create(
        model="meta-llama/Llama-3.3-70B-Instruct-Turbo",
        messages=[
            {
                    "role": "user",
                    "content": "Hi"
            },
        ],
        max_tokens=1,
        stream=False,
    )
    assert message.model == 'meta-llama/Llama-3.3-70B-Instruct-Turbo'

@pytest.mark.asyncio
async def test_async_together_image():
    """
    Tests asynchronous image generate.

    Raises:
        AssertionError: If the response object is not as expected.
    """

    response = await async_client.images.generate(
        prompt="AI Observability dashboard",
        model="black-forest-labs/FLUX.1-dev",
        width=768,
        height=768,
        n=1,
    )

    assert message.model == 'black-forest-labs/FLUX.1-dev'