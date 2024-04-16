# pylint: disable=duplicate-code
"""
This module contains tests for Cohere functionality using the Cohere Python library.

Tests cover various API endpoints, including chat and embeddings. 
These tests validate integration with OpenLIT.

Environment Variables:
    - COHERE_API_TOKEN: Cohere API api_key for authentication.

Note: Ensure the environment variables are properly set before running the tests.
"""

import os
import cohere
import openlit

# Global cohere client
sync_client = cohere.Client(os.getenv("COHERE_API_TOKEN"))

# Global cohere initialization
openlit.init(environment="dokumetry-testing", application_name="dokumetry-python-test")

def test_embed():
    """
    Tests synchronous embedding creation with the 'embed-english-v3.0' model.

    Raises:
        AssertionError: If the embedding response object is not as expected.
    """

    try:
        embeddings_resp = sync_client.embed(
            texts=['This is a test'],
            model='embed-english-v3.0'
        )
        assert embeddings_resp.meta is not None

    except cohere.core.api_error.ApiError as e:
        print("Rate Limited:", e)

def test_chat():
    """
    Tests synchronous chat with the 'command' model.

    Raises:
        AssertionError: If the chat response object is not as expected.
    """

    try:
        chat_resp = sync_client.chat(
            message='Say this is a test',
            model='command'
        )
        assert chat_resp.response_id is not None

    except cohere.core.api_error.ApiError as e:
        print("Rate Limited:", e)
