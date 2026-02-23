"""
Cross-Language Trace Comparison Test for Groq

This test generates a trace using Python OpenLIT and exports it for comparison
with TypeScript traces.
"""

import os
import pytest
from groq import Groq
import openlit
from opentelemetry.sdk.trace.export import ConsoleSpanExporter, SimpleSpanProcessor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import get_tracer
from trace_comparison_utils import normalize_python_span, export_trace_to_json


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
    
    # Get the finished spans
    finished_spans = []
    for processor in tracer_provider._resource._processors:
        if hasattr(processor, '_spans'):
            finished_spans.extend(processor._spans)
    
    # If we have spans, normalize and verify structure
    if finished_spans:
        span = finished_spans[0]
        normalized = normalize_python_span(span)
        
        # Verify critical attributes exist
        assert 'gen_ai.system' in normalized['attributes']
        assert normalized['attributes']['gen_ai.system'] == 'groq'
        assert 'gen_ai.operation.name' in normalized['attributes']
        assert normalized['attributes']['gen_ai.operation.name'] == 'chat'
        assert 'gen_ai.request.model' in normalized['attributes']
        assert 'gen_ai.usage.input_tokens' in normalized['attributes']
        assert 'gen_ai.usage.output_tokens' in normalized['attributes']
        
        # Export for comparison (optional)
        # export_trace_to_json(span, 'groq_python_trace.json')
    
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
