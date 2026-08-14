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


def _apply_preflight(
    pipeline: Pipeline,
    kwargs: Dict[str, Any],
    extract_input: Extractor,
) -> Tuple[Dict[str, Any], Optional[PipelineResult]]:
    """Run preflight guards. Returns (possibly-modified kwargs, result_or_None)."""
    input_text = extract_input(kwargs)
    if not input_text:
        return kwargs, None

    result = pipeline.evaluate(input_text, phase="preflight")

    if result.action == GuardAction.DENY:
        raise GuardDeniedError(result)

    if result.action == GuardAction.REDACT and result.transformed_text is not None:
        for key in ("messages", "input", "prompt", "text"):
            if key in kwargs:
                original = kwargs[key]
                if isinstance(original, str):
                    kwargs = {**kwargs, key: result.transformed_text}
                elif isinstance(original, list) and original:
                    new_messages = list(original)
                    last = new_messages[-1]
                    if isinstance(last, dict) and "content" in last:
                        new_messages[-1] = {**last, "content": result.transformed_text}
                        kwargs = {**kwargs, key: new_messages}
                break

    return kwargs, result


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
        is_async = "Async" in class_method
        try:
            if is_async:
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
