"""Tests for Mistral instrumentation setup."""

import openlit.instrumentation.mistral as mistral_instrumentation
from openlit._config import OpenlitConfig
from openlit.instrumentation.mistral import MistralInstrumentor


def test_mistral_instrumentor_registers_v1_and_v2_sdk_layouts(monkeypatch):
    """Mistral SDK 1.x and 2.x expose chat and embeddings under different modules."""
    OpenlitConfig.reset_to_defaults()
    wrapped_targets = []

    monkeypatch.setattr(
        mistral_instrumentation.importlib.metadata,
        "version",
        lambda package_name: "2.9.4",
    )
    monkeypatch.setattr(
        mistral_instrumentation,
        "wrap_function_wrapper",
        lambda module, class_method, wrapper: wrapped_targets.append(
            (module, class_method)
        ),
    )

    MistralInstrumentor()._instrument(
        environment="test",
        application_name="test",
        pricing_info={},
        disable_metrics=True,
    )

    assert set(wrapped_targets) == {
        ("mistralai.chat", "Chat.complete"),
        ("mistralai.chat", "Chat.stream"),
        ("mistralai.chat", "Chat.complete_async"),
        ("mistralai.chat", "Chat.stream_async"),
        ("mistralai.embeddings", "Embeddings.create"),
        ("mistralai.embeddings", "Embeddings.create_async"),
        ("mistralai.client.chat", "Chat.complete"),
        ("mistralai.client.chat", "Chat.stream"),
        ("mistralai.client.chat", "Chat.complete_async"),
        ("mistralai.client.chat", "Chat.stream_async"),
        ("mistralai.client.embeddings", "Embeddings.create"),
        ("mistralai.client.embeddings", "Embeddings.create_async"),
    }
