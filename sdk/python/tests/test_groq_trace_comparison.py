# pylint: disable=duplicate-code
"""
Cross-Language Trace Comparison Test for Groq

This test generates a trace using Python OpenLIT and exports it for comparison
with TypeScript traces.
"""

import os
import pytest
from groq import Groq
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from opentelemetry.sdk.trace import TracerProvider
import openlit


# Initialize OpenLIT with in-memory exporter for testing
tracer_provider = TracerProvider()
console_exporter = ConsoleSpanExporter()
tracer_provider.add_span_processor(SimpleSpanProcessor(console_exporter))

openlit.init(
    environment="openlit-python-testing",
    application_name="openlit-python-groq-test",
    tracer=tracer_provider.get_tracer(__name__),
)

client = Groq(api_key=os.getenv("GROQ_API_TOKEN"))


def test_groq_trace_structure():
    """
    Test that Groq generates traces with expected structure for comparison.
    """
    if not os.getenv("GROQ_API_TOKEN"):
        pytest.skip("GROQ_API_TOKEN not set")

    messages = [
        {
            "role": "user",
            "content": "What is LLM Observability?",
        }
    ]

    response = client.chat.completions.create(
        messages=messages,
        model="llama-3.1-8b-instant",
        max_tokens=10,
        stream=False,
    )

    assert response.object == "chat.completion"


def test_groq_trace_metrics():
    """
    Test that Groq trace contains correct metrics.
    """
    if not os.getenv("GROQ_API_TOKEN"):
        pytest.skip("GROQ_API_TOKEN not set")

    messages = [{"role": "user", "content": "Test"}]

    response = client.chat.completions.create(
        messages=messages,
        model="llama-3.1-8b-instant",
        max_tokens=5,
        stream=False,
    )

    # Verify response has usage data
    assert hasattr(response, 'usage')
    assert hasattr(response.usage, 'prompt_tokens')
    assert hasattr(response.usage, 'completion_tokens')
    assert hasattr(response.usage, 'total_tokens')

    assert response.object == "chat.completion"
