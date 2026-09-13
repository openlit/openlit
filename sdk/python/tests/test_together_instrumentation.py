"""Regression tests for the Together AI instrumentation wiring.

These need no API key and make no network calls. They assert that the
instrumentor actually binds to the installed ``together`` package, which the
response-shape assertions in ``test_together.py`` cannot do: those pass
identically whether instrumentation attached or not.

``together`` 2.0 renamed every resource class the instrumentor wraps
(``ChatCompletions`` -> ``CompletionsResource``, ``Images`` ->
``ImagesResource``, and the async pair). Because ``wrap_function_wrapper``
resolves eagerly, a stale name raises ``PathResolutionError``, which
``instrument_if_available`` swallows into a log line — leaving Together
silently untraced.
"""

import importlib

import pytest

from openlit.instrumentation.together import (
    ASYNC_CHAT_CLASSES,
    ASYNC_IMAGE_CLASSES,
    CHAT_CLASSES,
    IMAGE_CLASSES,
    TogetherInstrumentor,
    _wrap_first_present,
)

CHAT_MODULE = "together.resources.chat.completions"
IMAGE_MODULE = "together.resources.images"

TARGETS = [
    (CHAT_MODULE, CHAT_CLASSES, "create"),
    (CHAT_MODULE, ASYNC_CHAT_CLASSES, "create"),
    (IMAGE_MODULE, IMAGE_CLASSES, "generate"),
    (IMAGE_MODULE, ASYNC_IMAGE_CLASSES, "generate"),
]


@pytest.mark.parametrize("module_path,class_names,method", TARGETS)
def test_a_known_class_name_exists_on_the_installed_together(
    module_path, class_names, method
):
    """At least one candidate name must resolve, or the target goes untraced."""
    module = importlib.import_module(module_path)
    present = [name for name in class_names if getattr(module, name, None) is not None]
    assert present, (
        f"none of {list(class_names)} exist on {module_path}; the Together "
        f"instrumentation will not bind to .{method}()"
    )


@pytest.mark.parametrize("module_path,class_names,method", TARGETS)
def test_the_resolved_class_actually_has_the_method(module_path, class_names, method):
    module = importlib.import_module(module_path)
    resolved = next(
        getattr(module, name) for name in class_names if getattr(module, name, None)
    )
    assert hasattr(resolved, method), f"{resolved.__name__} has no .{method}() to wrap"


def test_wrap_first_present_reports_failure_instead_of_raising():
    """An unknown class must return False, not abort the rest of _instrument."""
    assert (
        _wrap_first_present(CHAT_MODULE, ("NoSuchClass",), "create", lambda *a: None)
        is False
    )


def test_wrap_first_present_tolerates_a_missing_module():
    assert (
        _wrap_first_present(
            "together.not_a_module", CHAT_CLASSES, "create", lambda *a: None
        )
        is False
    )


def test_instrumentation_dependencies_declared():
    assert any(
        "together" in dep
        for dep in TogetherInstrumentor().instrumentation_dependencies()
    )
