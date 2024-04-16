# pylint: disable=duplicate-code
"""
This module contains tests for Mistral functionality using the Mistral Python library.

Tests cover various API endpoints, including chat and embeddings. 
These tests validate integration with OpenLIT.

Environment Variables:
    - Mistral_API_TOKEN: Mistral API api_key for authentication.

Note: Ensure the environment variables are properly set before running the tests.
"""

import os
import pytest
from mistralai.client import MistralClient
from mistralai.async_client import MistralAsyncClient
from mistralai.models.chat_completion import ChatMessage
import openlit

# Initialize synchronous Mistral client
sync_client = MistralClient(
    api_key=os.getenv("MISTRAL_API_TOKEN")
)

# Initialize asynchronous Mistral client
async_client = MistralAsyncClient(
    api_key=os.getenv("MISTRAL_API_TOKEN")
)

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="dokumetry-testing", application_name="dokumetry-python-test")

def test_sync_mistral_chat():
    """
    Tests synchronous chat with the 'open-mistral-7b' model.

    Raises:
        AssertionError: If the chat response object is not as expected.
    """

    messages = [
        ChatMessage(role="user", content="What is the best French cheese?")
    ]

    message = sync_client.chat(
        model="open-mistral-7b",
        messages=messages,
        max_tokens=1,
    )
    assert message.object == 'chat.completion'

def test_sync_mistral_embeddings():
    """
    Tests synchronous embedding creation with the 'mistral-embed' model.

    Raises:
        AssertionError: If the embedding response object is not as expected.
    """

    response = sync_client.embeddings(
      model="mistral-embed",
      input=["Embed this sentence.", "As well as this one."],
    )
    assert response.object == 'list'

@pytest.mark.asyncio
async def test_async_mistral_chat():
    """
    Tests asynchronous chat with the 'open-mistral-7b' model.

    Raises:
        AssertionError: If the chat response object is not as expected.
    """

    messages = [
        ChatMessage(role="user", content="What is the best French cheese?")
    ]

    message = await async_client.chat(
        model="open-mistral-7b",
        messages=messages,
        max_tokens=1,
    )
    assert message.object == 'chat.completion'

# @pytest.mark.asyncio
# async def test_async_mistral_embeddings():
#     """
#     Tests asynchronous embedding creation with the 'mistral-embed' model.

#     Raises:
#         AssertionError: If the embedding response object is not as expected.
#     """

#     response = await async_client.embeddings(
#       model="mistral-embed",
#       input=["Embed this sentence.", "As well as this one."],
#     )
#     assert response.object == 'list'
