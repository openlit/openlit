"""
Auto-guard integration layer.

``setup_auto_guards`` wraps LLM provider methods a *second* time (after
the normal instrumentors) so that guards run on every call without any
changes to existing ``instrumentation/`` code.

Call chain after setup:

    User call
      -> Guard wrapper  (preflight → may deny/redact)
        -> Instrumentor wrapper  (OTel telemetry)
          -> Original SDK method  (actual API call)
        <- Instrumentor wrapper
      <- Guard wrapper  (postflight → may redact/warn)
    <- Returns to user

**Streaming limitation**: postflight guards require a complete response
object with ``choices[].message.content`` (or equivalent). Streaming
responses yield incremental chunks that extractors cannot fully
reassemble, so postflight guards are silently skipped for streamed
completions. Preflight guards always run.
"""

from __future__ import annotations

import importlib
import inspect
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

from wrapt import wrap_function_wrapper

from openlit.guard._base import (
    Guard,
    GuardAction,
    GuardDeniedError,
    PipelineResult,
)
from openlit.guard._pipeline import Pipeline

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Provider-specific text extractors
# ---------------------------------------------------------------------------


def _extract_openai_input(kwargs: Dict[str, Any]) -> str:
    messages = kwargs.get("messages") or kwargs.get("input") or []
    if isinstance(messages, str):
        return messages
    parts: List[str] = []
    for m in messages:
        if isinstance(m, dict):
            content = m.get("content", "")
            if isinstance(content, str):
                parts.append(content)
        elif isinstance(m, str):
            parts.append(m)
    return " ".join(parts)


def _extract_openai_output(response: Any) -> str:
    try:
        choices = getattr(response, "choices", None)
        if choices:
            return " ".join(
                getattr(getattr(c, "message", None), "content", "") or ""
                for c in choices
            )
        output = getattr(response, "output", None)
        if output:
            parts: List[str] = []
            for item in output:
                msg = getattr(item, "content", None)
                if isinstance(msg, list):
                    for block in msg:
                        text = getattr(block, "text", None)
                        if text:
                            parts.append(text)
                elif isinstance(msg, str):
                    parts.append(msg)
            return " ".join(parts)
    except Exception:
        pass
    return ""


def _extract_anthropic_input(kwargs: Dict[str, Any]) -> str:
    messages = kwargs.get("messages", [])
    parts: List[str] = []
    for m in messages:
        if isinstance(m, dict):
            content = m.get("content", "")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        parts.append(block.get("text", ""))
    return " ".join(parts)


def _extract_anthropic_output(response: Any) -> str:
    try:
        content = getattr(response, "content", [])
        parts: List[str] = []
        for block in content:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
        return " ".join(parts)
    except Exception:
        return ""


def _extract_generic_input(kwargs: Dict[str, Any]) -> str:
    for key in ("messages", "message", "prompt", "input", "text"):
        val = kwargs.get(key)
        if val is None:
            continue
        if isinstance(val, str):
            return val
        if isinstance(val, list):
            parts: List[str] = []
            for item in val:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    parts.append(item.get("content", "") or "")
            return " ".join(parts)
    return ""


def _extract_generic_output(response: Any) -> str:
    try:
        choices = getattr(response, "choices", None)
        if choices:
            return " ".join(
                getattr(getattr(c, "message", None), "content", "") or ""
                for c in choices
            )
    except Exception:
        pass
    try:
        content = getattr(response, "content", None)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: List[str] = []
            for block in content:
                text = getattr(block, "text", None)
                if text:
                    parts.append(text)
            if parts:
                return " ".join(parts)
    except Exception:
        pass
    try:
        text = getattr(response, "text", None)
        if text:
            return text
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# Methods to guard:  (module, class.method, input_extractor, output_extractor)
# Only text-in / text-out methods; skip embeddings, images, audio, etc.
# ---------------------------------------------------------------------------

Extractor = Callable[..., str]

GUARDED_METHODS: List[Tuple[str, str, Extractor, Extractor]] = [
    # OpenAI
    (
        "openai.resources.chat.completions",
        "Completions.create",
        _extract_openai_input,
        _extract_openai_output,
    ),
    (
        "openai.resources.chat.completions",
        "AsyncCompletions.create",
        _extract_openai_input,
        _extract_openai_output,
    ),
    (
        "openai.resources.chat.completions",
        "Completions.parse",
        _extract_openai_input,
        _extract_openai_output,
    ),
    (
        "openai.resources.chat.completions",
        "AsyncCompletions.parse",
        _extract_openai_input,
        _extract_openai_output,
    ),
    (
        "openai.resources.responses.responses",
        "Responses.create",
        _extract_openai_input,
        _extract_openai_output,
    ),
    (
        "openai.resources.responses.responses",
        "AsyncResponses.create",
        _extract_openai_input,
        _extract_openai_output,
    ),
    # Anthropic
    (
        "anthropic.resources.messages",
        "Messages.create",
        _extract_anthropic_input,
        _extract_anthropic_output,
    ),
    (
        "anthropic.resources.messages",
        "AsyncMessages.create",
        _extract_anthropic_input,
        _extract_anthropic_output,
    ),
    # Groq
    (
        "groq.resources.chat.completions",
        "Completions.create",
        _extract_generic_input,
        _extract_generic_output,
    ),
    (
        "groq.resources.chat.completions",
        "AsyncCompletions.create",
        _extract_generic_input,
        _extract_generic_output,
    ),
    # Mistral
    (
        "mistralai.chat",
        "Chat.complete",
        _extract_generic_input,
        _extract_generic_output,
    ),
    (
        "mistralai.chat",
        "Chat.complete_async",
        _extract_generic_input,
        _extract_generic_output,
    ),
    (
        "mistralai.client.chat",
        "Chat.complete",
        _extract_generic_input,
        _extract_generic_output,
    ),
    (
        "mistralai.client.chat",
        "Chat.complete_async",
        _extract_generic_input,
        _extract_generic_output,
    ),
    # Cohere
    (
        "cohere.client_v2",
        "ClientV2.chat",
        _extract_generic_input,
        _extract_generic_output,
    ),
    (
        "cohere.client_v2",
        "AsyncClientV2.chat",
        _extract_generic_input,
        _extract_generic_output,
    ),
    # Together
    (
        "together.resources.chat.completions",
        "Completions.create",
        _extract_generic_input,
        _extract_generic_output,
    ),
    (
        "together.resources.chat.completions",
        "AsyncCompletions.create",
        _extract_generic_input,
        _extract_generic_output,
    ),
]


# ---------------------------------------------------------------------------
# Guard wrapper factories
# ---------------------------------------------------------------------------


def _iter_text_paths(kwargs: Dict[str, Any]):
    """Yield a path for every independent text field in ``kwargs``.

    A path is a tuple of dict keys and list indexes locating a string the
    guards should inspect. Recognised containers are checked in the same order
    as the provider extractors and the first one present wins. A multi-turn
    ``messages`` list therefore yields one path per turn instead of a single
    concatenated blob that can only be written back to the last message.
    """
    for key in ("messages", "input", "message", "prompt", "text"):
        value = kwargs.get(key)
        if not value:
            continue
        if isinstance(value, str):
            yield (key,)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                if isinstance(item, str):
                    yield (key, index)
                elif isinstance(item, dict):
                    content = item.get("content")
                    if isinstance(content, str):
                        yield (key, index, "content")
                    elif isinstance(content, list):
                        for block_index, block in enumerate(content):
                            if isinstance(block, dict) and isinstance(
                                block.get("text"), str
                            ):
                                yield (key, index, "content", block_index, "text")
        return


def _read_text_at_path(kwargs: Dict[str, Any], path: Tuple) -> Optional[str]:
    """Read the string located at ``path`` in ``kwargs``."""
    value: Any = kwargs
    for step in path:
        if isinstance(value, dict):
            value = value.get(step)
        elif isinstance(value, list) and isinstance(step, int) and 0 <= step < len(value):
            value = value[step]
        else:
            return None
    return value if isinstance(value, str) else None


def _write_text_at_path(
    kwargs: Dict[str, Any], path: Tuple, text: str
) -> Dict[str, Any]:
    """Return a copy of ``kwargs`` with the string at ``path`` replaced."""
    result: Dict[str, Any] = {**kwargs}
    container: Any = result
    for step in path[:-1]:
        child = container[step]
        if isinstance(child, dict):
            container[step] = {**child}
        elif isinstance(child, list):
            container[step] = list(child)
        else:
            return result
        container = container[step]
    container[path[-1]] = text
    return result


def _apply_preflight(
    pipeline: Pipeline,
    kwargs: Dict[str, Any],
    extract_input: Extractor,
) -> Tuple[Dict[str, Any], Optional[PipelineResult]]:
    """Run preflight guards on every text field. Returns (kwargs, result_or_None)."""
    slots = []
    for path in _iter_text_paths(kwargs):
        text = _read_text_at_path(kwargs, path)
        if text:
            slots.append((path, text))

    if not slots:
        # Unstructured input: fall back to the provider extractor so that deny
        # and redact still see the whole text when no writable field is known.
        input_text = extract_input(kwargs)
        if not input_text:
            return kwargs, None
        result = pipeline.evaluate(input_text, phase="preflight")
        if result.action == GuardAction.DENY:
            raise GuardDeniedError(result)
        return kwargs, result

    updated_kwargs = kwargs
    last_result: Optional[PipelineResult] = None
    for path, text in slots:
        result = pipeline.evaluate(text, phase="preflight")

        if result.action == GuardAction.DENY:
            raise GuardDeniedError(result)

        if result.action == GuardAction.REDACT and result.transformed_text is not None:
            updated_kwargs = _write_text_at_path(
                updated_kwargs, path, result.transformed_text
            )

        last_result = result

    return updated_kwargs, last_result


def _apply_postflight(
    pipeline: Pipeline,
    response: Any,
    extract_output: Extractor,
) -> Any:
    """Run postflight guards on the response. Applies REDACT to response content."""
    output_text = extract_output(response)
    if not output_text:
        return response

    result = pipeline.evaluate(output_text, phase="postflight")

    if result.action == GuardAction.DENY:
        raise GuardDeniedError(result)

    if result.action == GuardAction.REDACT and result.transformed_text is not None:
        try:
            choices = getattr(response, "choices", None)
            if choices:
                for choice in choices:
                    msg = getattr(choice, "message", None)
                    if msg and hasattr(msg, "content"):
                        msg.content = result.transformed_text
            else:
                content = getattr(response, "content", None)
                if isinstance(content, list) and content:
                    for block in content:
                        if hasattr(block, "text"):
                            block.text = result.transformed_text
                            break
                elif hasattr(response, "text"):
                    response.text = result.transformed_text
        except Exception:
            pass

    return response


def _is_async_method(module_path: str, class_method: str) -> bool:
    """Return True when the provider method has to be awaited.

    The name is not a reliable signal: Mistral spells its async chat method
    ``Chat.complete_async``, so a ``"Async" in class_method`` check installs the
    sync wrapper on a coroutine function and the postflight guards never run.
    Resolve the attribute instead, unwrapping the instrumentor wrapper that is
    already installed on it by the time guards are set up.
    """
    class_name, method_name = class_method.split(".", 1)
    module = importlib.import_module(module_path)
    method = getattr(getattr(module, class_name), method_name)
    return inspect.iscoroutinefunction(inspect.unwrap(method))


def _make_sync_guard_wrapper(
    pipeline: Pipeline,
    extract_input: Extractor,
    extract_output: Extractor,
):
    def _guard_wrapper(wrapped, instance, args, kwargs):
        kwargs, _ = _apply_preflight(pipeline, kwargs, extract_input)
        response = wrapped(*args, **kwargs)
        response = _apply_postflight(pipeline, response, extract_output)
        return response

    return _guard_wrapper


def _make_async_guard_wrapper(
    pipeline: Pipeline,
    extract_input: Extractor,
    extract_output: Extractor,
):
    async def _async_guard_wrapper(wrapped, instance, args, kwargs):
        kwargs, _ = _apply_preflight(pipeline, kwargs, extract_input)
        response = await wrapped(*args, **kwargs)
        response = _apply_postflight(pipeline, response, extract_output)
        return response

    return _async_guard_wrapper


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def setup_auto_guards(
    guards: List[Guard],
    fail_open: bool = True,
) -> None:
    """
    Wrap all known LLM provider methods with guard logic.

    Called from ``openlit.init()`` *after* all normal instrumentors have run.
    """
    pipeline = Pipeline(guards=guards, fail_open=fail_open)

    from openlit._config import OpenlitConfig

    OpenlitConfig.guard_pipeline = pipeline

    wrapped_count = 0
    for module_path, class_method, extract_in, extract_out in GUARDED_METHODS:
        try:
            if _is_async_method(module_path, class_method):
                wrapper = _make_async_guard_wrapper(pipeline, extract_in, extract_out)
            else:
                wrapper = _make_sync_guard_wrapper(pipeline, extract_in, extract_out)

            wrap_function_wrapper(module_path, class_method, wrapper)
            wrapped_count += 1
        except Exception:
            logger.debug(
                "Could not wrap %s.%s with guard — module likely not installed",
                module_path,
                class_method,
            )

    logger.info(
        "Auto-guards: wrapped %d/%d provider methods",
        wrapped_count,
        len(GUARDED_METHODS),
    )
