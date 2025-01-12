# pylint: disable=duplicate-code, no-name-in-module
"""
This module contains tests for Google AI Studio functionality using the google-generativeai
Python library.

Tests cover various API endpoints, including chat. 
These tests validate integration with OpenLIT.

Environment Variables:
    - GOOGLE_AI_STUDIO_API_TOKEN: Google AI Studio API api_key for authentication.

Note: Ensure the environment is properly configured for Google AI Studio access and
OpenLIT monitoring prior to running these tests.
"""

import os
import pytest
import google.generativeai as genai
import openlit

# Initialize Google AI Studio client
genai.configure(api_key=os.getenv("GOOGLE_AI_STUDIO_API_TOKEN"))
model = genai.GenerativeModel("gemini-1.5-flash")

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")

def test_sync_generate_content():
    """
    Tests synchronous Generate content with the "gemini-1.5-flash" model.

    Raises:
        AssertionError: If the generate content response object is not as expected.
    """

    try:
        response = model.generate_content("Observability for LLMs", stream=False)
        assert isinstance(response.text, str)

        response = model.generate_content("Monitor AI", stream=True)
        for text in response:
            assert isinstance(text.text, str)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise

@pytest.mark.asyncio
async def test_async_generate_content():
    """
    Tests synchronous Generate content with the "gemini-1.5-flash" model.

    Raises:
        AssertionError: If the generate content response object is not as expected.
    """

    try:
        response = await model.generate_content_async("Observability for LLMs", stream=False)
        assert isinstance(response.text, str)

        response = await model.generate_content_async("Monitor AI", stream=True)
        async for text in response:
            assert isinstance(text.text, str)

    # pylint: disable=broad-exception-caught
    except Exception as e:
        if "rate limit" in str(e).lower():
            print("Rate Limited:", e)
        else:
            raise
