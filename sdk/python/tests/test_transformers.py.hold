# pylint: disable=duplicate-code, no-name-in-module
"""
This module contains tests for Text Generation functionality in HuggingFace Transformers library.

Tests cover the usage of the Transformers' pipeline for generating text. 
These tests validate integration with OpenLIT.

Note: Ensure the environment is properly configured for Transformers and OpenLIT monitoring
prior to running these tests.
"""

from transformers import pipeline
import openlit

# Initialize environment and application name for OpenLIT monitoring
openlit.init(environment="openlit-testing", application_name="openlit-python-test")

def test_text_trasnformers():
    """
    Test text generation capabilities using the GPT-2 model from HuggingFace Transformers library.

    This test sends a prompt to a pre-specified model and verifies that the response contains
    generated text matching expected criteria. 
    In this case, simply the presence of the 'generated_text' field in the response object.

    Raises:
        AssertionError: If the 'generated_text' field is missing from any part of the response.
    """

    generator = pipeline(model="openai-community/gpt2")
    response = generator("My tart needs some", num_return_sequences=1, return_full_text=False)
    for output in response:
        assert 'generated_text' in output
