# pylint: disable=duplicate-code, no-name-in-module
"""
This module contains tests for Anthropic functionality using the Anthropic Python library.

Tests cover various API endpoints, including chat. 
These tests validate integration with OpenLIT.

Environment Variables:
    - ANTHROPIC_API_TOKEN: Anthropic API api_key for authentication.

Note: Ensure the environment is properly configured for Anthropic access and OpenLIT monitoring
prior to running these tests.
"""

from transformers import pipeline
import openlit

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")

def test_sync_anthropic_messages():
    """
    Tests synchronous messages with the 'claude-3-haiku-20240307' model.

    Raises:
        AssertionError: If the messages response object is not as expected.
    """

    generator = pipeline(model="openai-community/gpt2")
    response = generator("My tart needs some", num_return_sequences=1, return_full_text=False)
    for output in response:
        assert 'generated_text' in output