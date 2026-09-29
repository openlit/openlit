# pylint: disable=missing-function-docstring, missing-class-docstring
"""
Unit tests for instrumentor name resolution.

``disabled_instrumentors`` is matched against the canonical keys of
``MODULE_NAME_MAP``, and those keys are not consistent about hyphens versus
underscores (``llama_index`` and ``pydantic_ai`` next to ``openai-agents`` and
``google-ai-studio``). A name that does not resolve is dropped with a warning
and the instrumentation stays enabled, so every spelling a user can reasonably
reach for has to normalize onto its canonical key.
"""

from openlit._instrumentors import (
    INSTRUMENTOR_ALIASES,
    INSTRUMENTOR_MAP,
    MODULE_NAME_MAP,
    normalize_instrumentor_name,
    normalize_instrumentor_names,
)


def test_both_separator_spellings_resolve():
    """Every canonical key is reachable with hyphens or with underscores."""
    unreachable = []
    for key in MODULE_NAME_MAP:
        for spelling in (key.replace("-", "_"), key.replace("_", "-")):
            if normalize_instrumentor_name(spelling) not in MODULE_NAME_MAP:
                unreachable.append(spelling)
    assert not unreachable, f"unreachable spellings: {unreachable}"


def test_aliases_point_at_canonical_keys():
    """No alias may resolve to a name that is not itself an instrumentor."""
    dangling = [
        (alias, target)
        for alias, target in INSTRUMENTOR_ALIASES.items()
        if target not in MODULE_NAME_MAP
    ]
    assert not dangling, f"aliases pointing nowhere: {dangling}"


def test_aliases_do_not_shadow_canonical_keys():
    shadowing = [alias for alias in INSTRUMENTOR_ALIASES if alias in MODULE_NAME_MAP]
    assert not shadowing, f"aliases shadowing canonical keys: {shadowing}"


def test_the_two_registries_agree():
    assert sorted(MODULE_NAME_MAP) == sorted(INSTRUMENTOR_MAP)


def test_distribution_names_resolve():
    """The names the instrumentations declare in ``_instruments`` resolve."""
    assert normalize_instrumentor_name("llama-index") == "llama_index"
    assert normalize_instrumentor_name("pydantic-ai") == "pydantic_ai"
    assert normalize_instrumentor_name("reka-api") == "reka-api"


def test_module_directory_names_resolve():
    """``openlit/instrumentation/llamaindex`` is also spelled without a separator."""
    assert normalize_instrumentor_name("llamaindex") == "llama_index"


def test_normalization_is_case_insensitive():
    assert normalize_instrumentor_names(["LlamaIndex", "Pydantic-AI", "AIOHTTP"]) == [
        "llama_index",
        "pydantic_ai",
        "aiohttp-client",
    ]


def test_unknown_names_pass_through_unchanged():
    assert normalize_instrumentor_name("not-an-instrumentor") == "not-an-instrumentor"
    assert not normalize_instrumentor_names([])
    assert not normalize_instrumentor_names(None)
