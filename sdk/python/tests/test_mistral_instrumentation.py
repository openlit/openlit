# pylint: disable=protected-access, missing-class-docstring, missing-function-docstring, too-few-public-methods
"""Tests for Mistral instrumentation setup."""

import sys
import types

import openlit.instrumentation.mistral as mistral_instrumentation
from openlit._config import OpenlitConfig
from openlit.instrumentation.mistral import MistralInstrumentor

EXPECTED_TARGETS = {
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


def _instrument(**kwargs):
    OpenlitConfig.reset_to_defaults()
    MistralInstrumentor()._instrument(
        environment="test",
        application_name="test",
        pricing_info={},
        disable_metrics=True,
        **kwargs,
    )


def test_mistral_instrumentor_registers_v1_and_v2_sdk_layouts(monkeypatch):
    """Mistral SDK 1.x and 2.x expose chat and embeddings under different modules."""
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

    _instrument()

    assert set(wrapped_targets) == EXPECTED_TARGETS


def test_mistral_instrumentor_skips_missing_layout_and_wraps_available(monkeypatch):
    """A missing 1.x module must not abort 2.x wrapping (wrapt 2.x raises)."""
    wrapped_targets = []
    v1_modules = {"mistralai.chat", "mistralai.embeddings"}

    def fake_wrap(module, class_method, wrapper):
        if module in v1_modules:
            raise ModuleNotFoundError(module)
        wrapped_targets.append((module, class_method))

    monkeypatch.setattr(
        mistral_instrumentation.importlib.metadata,
        "version",
        lambda package_name: "2.9.4",
    )
    monkeypatch.setattr(
        mistral_instrumentation, "wrap_function_wrapper", fake_wrap
    )

    _instrument()

    assert set(wrapped_targets) == {
        target for target in EXPECTED_TARGETS if target[0] not in v1_modules
    }


def test_mistral_instrumentor_binds_v2_chat_complete(monkeypatch):
    """Wrapping mistralai.client.chat must intercept Chat.complete."""
    package = types.ModuleType("mistralai")
    package.__path__ = []
    client = types.ModuleType("mistralai.client")
    client.__path__ = []
    chat = types.ModuleType("mistralai.client.chat")

    class Chat:
        def complete(self, **kwargs):
            return kwargs.get("model", "ok")

    chat.Chat = Chat
    client.chat = chat
    package.client = client

    added = {
        "mistralai": package,
        "mistralai.client": client,
        "mistralai.client.chat": chat,
    }
    original = {name: sys.modules.get(name) for name in added}
    sys.modules.update(added)

    monkeypatch.setattr(
        mistral_instrumentation.importlib.metadata,
        "version",
        lambda package_name: "2.9.4",
    )
    monkeypatch.setattr(
        mistral_instrumentation, "_CHAT_MODULES", ("mistralai.client.chat",)
    )
    monkeypatch.setattr(mistral_instrumentation, "_EMBEDDINGS_MODULES", ())

    try:
        _instrument()
        assert Chat().complete(model="mistral-small-latest") == "mistral-small-latest"
        assert hasattr(Chat.complete, "__wrapped__")
    finally:
        for name, previous in original.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous
