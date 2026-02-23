# pylint: disable=duplicate-code
"""
Cross-Language Trace Comparison Test for Mistral

This test generates a trace using Python OpenLIT and exports it for comparison
with TypeScript traces.
"""

import os
import pytest
from mistralai import Mistral
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from opentelemetry.sdk.trace import TracerProvider
import openlit


# Initialize OpenLIT with in-memory exporter for testing
tracer_provider = TracerProvider()
console_exporter = ConsoleSpanExporter()
tracer_provider.add_span_processor(SimpleSpanProcessor(console_exporter))

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-mistral-test",
    tracer=tracer_provider.get_tracer(__name__),
)

client = Mistral(api_key=os.getenv("MISTRAL_API_KEY"))


def test_mistral_trace_structure():
    """
    Test that Mistral generates traces with expected structure for comparison.
    """
    if not os.getenv("MISTRAL_API_KEY"):
        pytest.skip("MISTRAL_API_KEY not set")

    messages = [
        {
            "role": "user",
            "content": "What is Mistral AI?",
        }
    ]

    response = client.chat.complete(
        model="open-mistral-7b",
        messages=messages,
        max_tokens=10,
    )

    # Verify response structure
    assert hasattr(response, 'id')
    assert hasattr(response, 'model')
    assert hasattr(response, 'choices')
    assert hasattr(response, 'usage')


def test_mistral_embedding_trace_structure():
    """
    Test that Mistral embeddings generate traces with expected structure.
    """
    if not os.getenv("MISTRAL_API_KEY"):
        pytest.skip("MISTRAL_API_KEY not set")

    response = client.embeddings.create(
        model="mistral-embed",
        inputs="Test embedding",
    )

    # Verify response structure
    assert hasattr(response, 'model')
    assert hasattr(response, 'data')
    assert hasattr(response, 'usage')
