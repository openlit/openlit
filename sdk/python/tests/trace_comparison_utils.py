"""
Python Trace Export Utility for Cross-Language Comparison

This module provides utilities to export Python OpenLIT traces in a format
that can be compared with TypeScript traces.
"""

import json
from typing import Dict, Any
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


def normalize_python_span(span: ReadableSpan) -> Dict[str, Any]:
    """
    Normalize a Python OpenTelemetry span to a comparable format.

    Args:
        span: OpenTelemetry ReadableSpan from Python SDK

    Returns:
        Normalized trace dictionary matching TypeScript format
    """
    attributes = {}
    for key, value in span.attributes.items():
        # Normalize arrays
        if isinstance(value, (list, tuple)):
            attributes[key] = sorted(list(value))
        # Normalize numbers (round to 3 decimal places)
        elif isinstance(value, float):
            attributes[key] = round(value * 1000) / 1000
        elif isinstance(value, int):
            attributes[key] = value
        # Normalize strings
        elif isinstance(value, str):
            attributes[key] = value.strip()
        else:
            attributes[key] = value

    events = []
    for event in span.events:
        event_attrs = {}
        for key, value in event.attributes.items():
            if isinstance(value, (list, tuple)):
                event_attrs[key] = sorted(list(value))
            elif isinstance(value, float):
                event_attrs[key] = round(value * 1000) / 1000
            elif isinstance(value, int):
                event_attrs[key] = value
            elif isinstance(value, str):
                event_attrs[key] = value.strip()
            else:
                event_attrs[key] = value

        events.append({
            'name': event.name,
            'attributes': event_attrs,
        })

    # Normalize status
    from opentelemetry.trace import StatusCode  # pylint: disable=import-outside-toplevel
    status_code = 'UNSET'
    if span.status.status_code == StatusCode.OK:
        status_code = 'OK'
    elif span.status.status_code == StatusCode.ERROR:
        status_code = 'ERROR'

    return {
        'spanName': span.name,
        'spanKind': str(span.kind),
        'attributes': attributes,
        'events': events,
        'status': {
            'code': status_code,
            'message': span.status.description,
        },
        'duration': span.end_time - span.start_time if span.end_time and span.start_time else None,
    }


def export_trace_to_json(span: ReadableSpan, filepath: str) -> None:
    """
    Export a normalized trace to JSON file for comparison.

    Args:
        span: OpenTelemetry ReadableSpan
        filepath: Path to save JSON file
    """
    normalized = normalize_python_span(span)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(normalized, f, indent=2, default=str)


def compare_with_typescript(
    python_span: ReadableSpan,
    typescript_trace_path: str
) -> Dict[str, Any]:
    """
    Compare Python trace with TypeScript trace from JSON file.

    Args:
        python_span: Python OpenTelemetry span
        typescript_trace_path: Path to TypeScript trace JSON file

    Returns:
        Comparison result dictionary
    """
    python_normalized = normalize_python_span(python_span)

    with open(typescript_trace_path, 'r', encoding='utf-8') as f:
        typescript_normalized = json.load(f)

    differences = []

    # Compare critical attributes
    critical_attrs = [
        'gen_ai.system',
        'gen_ai.operation.name',
        'gen_ai.request.model',
        'gen_ai.response.model',
        'gen_ai.usage.input_tokens',
        'gen_ai.usage.output_tokens',
        'gen_ai.usage.total_tokens',
    ]

    for attr in critical_attrs:
        python_val = python_normalized['attributes'].get(attr)
        typescript_val = typescript_normalized['attributes'].get(attr)

        if python_val != typescript_val:
            differences.append(
                f"Attribute '{attr}': Python={python_val}, TypeScript={typescript_val}"
            )

    return {
        'match': len(differences) == 0,
        'differences': differences,
        'pythonTrace': python_normalized,
        'typescriptTrace': typescript_normalized,
    }


def get_finished_spans(exporter: InMemorySpanExporter) -> list:
    """
    Get finished spans from an InMemorySpanExporter.

    Args:
        exporter: InMemorySpanExporter instance

    Returns:
        List of finished ReadableSpan objects
    """
    return list(exporter.get_finished_spans())


def extract_key_metrics(span: ReadableSpan) -> Dict[str, Any]:
    """
    Extract key metrics from a span for comparison.

    Args:
        span: OpenTelemetry ReadableSpan

    Returns:
        Dictionary with key metrics
    """
    attrs = span.attributes

    return {
        'tokens': {
            'input': attrs.get('gen_ai.usage.input_tokens', 0),
            'output': attrs.get('gen_ai.usage.output_tokens', 0),
            'total': attrs.get('gen_ai.usage.total_tokens', 0),
        },
        'cost': attrs.get('gen_ai.usage.cost', 0),
        'model': attrs.get('gen_ai.request.model') or attrs.get('gen_ai.response.model', ''),
        'operation': attrs.get('gen_ai.operation.name', ''),
        'system': attrs.get('gen_ai.system', ''),
    }
