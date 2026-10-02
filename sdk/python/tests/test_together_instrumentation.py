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


def test_wrap_first_present_skips_a_candidate_that_lacks_the_method():
    """A class present without the method must not be chosen.

    During a partial rename a release can expose both names while only one
    still implements the method; picking on class name alone would raise the
    PathResolutionError this helper exists to avoid.
    """
    calls = []

    class Stub:
        pass

    module = importlib.import_module(CHAT_MODULE)
    module.StubWithoutCreate = Stub
    try:
        wrapped = _wrap_first_present(
            CHAT_MODULE,
            ("StubWithoutCreate",) + tuple(CHAT_CLASSES),
            "create",
            lambda *a: calls.append(a),
        )
    finally:
        delattr(module, "StubWithoutCreate")

    assert wrapped is True


def test_instrument_binds_every_target(monkeypatch):
    """Guards the wiring, not just the constants.

    Without this, an _instrument() reverted to stale hardcoded targets still
    passes every other test in this file while Together goes untraced.
    """
    from openlit._config import OpenlitConfig
    from openlit.instrumentation import together as together_module

    # normally populated by openlit.init(); not needed to check the wiring
    monkeypatch.setattr(OpenlitConfig, "metrics_dict", {}, raising=False)

    wrapped = []
    monkeypatch.setattr(
        together_module,
        "wrap_function_wrapper",
        lambda module_path, class_method, _wrapper: wrapped.append(
            (module_path, class_method)
        ),
    )

    TogetherInstrumentor()._instrument()

    assert len(wrapped) == 4, f"expected 4 wrapped targets, got {wrapped}"

    modules = {module_path for module_path, _ in wrapped}
    assert modules == {CHAT_MODULE, IMAGE_MODULE}

    methods = sorted(class_method.split(".", 1)[1] for _, class_method in wrapped)
    assert methods == ["create", "create", "generate", "generate"]

    # every wrapped path must resolve on the installed together
    for module_path, class_method in wrapped:
        module = importlib.import_module(module_path)
        class_name, method = class_method.split(".", 1)
        resolved = getattr(module, class_name, None)
        assert resolved is not None, f"{class_method} does not exist on {module_path}"
        assert hasattr(resolved, method), f"{class_name} has no .{method}()"


def test_instrumentation_dependencies_declared():
    assert any(
        "together" in dep
        for dep in TogetherInstrumentor().instrumentation_dependencies()
    )
