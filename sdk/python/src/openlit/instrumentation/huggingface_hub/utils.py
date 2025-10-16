"""
Utility functions for HuggingFace Hub instrumentation
"""

import logging
from typing import Any, Dict, Optional

from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import common_framework_span_attributes
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

HF_OPERATION_MAP = {
    # Models
    "list_models": "list_models",
    "model_info": "model_info",

    # Repository
    "list_repo_files": "list_repo_files",
    "repo_info": "repo_info",
    "get_collection": "get_collection",
    "get_full_repo_name": "get_full_repo_name",

    # File operations
    "upload_file": "upload_file",
    "upload_folder": "upload_folder",
    "file_download": "download",
    "hf_hub_download": "download",
}


class HFInstrumentationContext:
    """Context object to cache extractions for HuggingFace Hub calls."""

    __slots__ = (
        "instance",
        "args",
        "kwargs",
        "version",
        "environment",
        "application_name",
        "_repo_id",
        "_filename",
    )

    def __init__(self, instance, args, kwargs, version, environment, application_name):
        self.instance = instance
        self.args = args
        self.kwargs = kwargs
        self.version = version
        self.environment = environment
        self.application_name = application_name
        self._repo_id = None
        self._filename = None
        self.url = None

    @property
    def repo_id(self) -> str:
        if self._repo_id is None:
            if len(self.args) > 0:
                self._repo_id = str(self.args[0])
            else:
                self._repo_id = str(self.kwargs.get("repo_id") or self.kwargs.get("repo") or "unknown")
        return self._repo_id

    @property
    def filename(self) -> str:
        if self._filename is None:
            if len(self.args) > 1:
                self._filename = str(self.args[1])
            else:
                self._filename = str(self.kwargs.get("filename") or self.kwargs.get("filename_or_url") or "unknown")
        return self._filename


def get_operation_name(endpoint: str) -> str:
    """Return normalized operation name for the endpoint."""
    return HF_OPERATION_MAP.get(endpoint, endpoint or "hub_operation")


def get_span_name(operation_name: str, ctx: HFInstrumentationContext, endpoint: str) -> str:
    """Create a span name following the '{operation} {target}' pattern.

    For HF operations we try to include repo and filename when available.
    """
    parts = []
    if operation_name:
        parts.append(operation_name)

    # Prefer showing repo and filename if present
    if ctx.repo_id and ctx.repo_id != "unknown":
        if ctx.filename and ctx.filename != "unknown":
            parts.append(f"{ctx.repo_id}/{ctx.filename}")
        else:
            parts.append(str(ctx.repo_id))

    if parts:
        return " ".join(parts)
    return operation_name or endpoint


def set_span_attributes(
    span,
    operation_name: str,
    ctx: HFInstrumentationContext,
    endpoint: Optional[str] = None,
    pricing_info: Optional[Dict[str, Any]] = None,
    trace_content: bool = True,
    **kwargs,
):
    """Set a set of attributes for HF Hub operations.

    Create a small scope-like
    object and call `common_framework_span_attributes` to fill standard fields,
    then add HF-specific attributes such as repo and filename when available.
    """
    try:
        scope = type("Scope", (), {})()
        # attach writable attributes expected by common_framework_span_attributes
        scope._span = span
        scope._start_time = getattr(span, "start_time", None)
        scope._end_time = getattr(span, "end_time", None)
        # endpoint_label = endpoint or operation_name or "hub.operation"

        common_framework_span_attributes(
            scope,
            SemanticConvention.GEN_AI_SYSTEM_HUGGINGFACE_HUB,
            "huggingface.co",
            443,
            ctx.environment,
            ctx.application_name,
            ctx.version,
            operation_name,
            instance=ctx.instance,
        )

        span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_name)

        # Set HF-specific attributes
        if ctx.repo_id and ctx.repo_id != "unknown":
            span.set_attribute("huggingface.repo_id", ctx.repo_id)
        if ctx.filename and ctx.filename != "unknown":
            span.set_attribute("huggingface.filename", ctx.filename)

        # Optionally include pricing_info or trace_content markers
        if pricing_info:
            span.set_attribute("huggingface.pricing_present", True)
        if not trace_content:
            span.set_attribute("huggingface.trace_content", False)

        # URL information
        if ctx.url and ctx.url != "unknown":
            span.set_attribute(SemanticConvention.GEN_AI_AGENT_BROWSE_URL, ctx.url)
    except Exception as e:
        logger.debug("Failed setting HF span attributes: %s", e)


def process_response(
    span,
    response,
    ctx: HFInstrumentationContext,
    endpoint: Optional[str] = None,
    pricing_info: Optional[Dict[str, Any]] = None,
    trace_content: bool = True,
    **kwargs,
):
    """Lightweight response processing for HF Hub calls.

    This sets a few useful attributes (path, size if available) and marks span OK.
    """
    try:
        if response is None:
            return

        # If the hf_hub_download returns a path (str), record it
        if isinstance(response, str):
            span.set_attribute("gen_ai.response.path", response)
        # If response has attributes like 'url' or 'sha', set them
        elif isinstance(response, dict):
            for key in ("url", "sha", "etag"):
                if key in response:
                    span.set_attribute(f"huggingface.response.{key}", str(response[key]))

        # Mark successful
        span.set_status(Status(StatusCode.OK))
    except Exception as e:
        logger.debug("Error processing HF response: %s", e)


def handle_hfhub_error(span, error):
    try:
        span.record_exception(error)

        # Set error status
        span.set_status(Status(StatusCode.ERROR, str(error)))

        # Set error type and message
        span.set_attribute("error.type", type(error).__name__)
        span.set_attribute("error.message", str(error))

        # Handle specific error types
        if hasattr(error, "response"):
            # HTTP error
            response = error.response
            if hasattr(response, "status_code"):
                span.set_attribute("http.status_code", response.status_code)
            if hasattr(response, "text"):
                span.set_attribute(
                    "error.response_text", response.text[:500]
                )  # Limit error text

        # Additional error categorization using standard patterns
        error_message = str(error).lower()
        if "rate limit" in error_message:
            span.set_attribute("error.category", "rate_limit")
        elif "api key" in error_message or "authentication" in error_message:
            span.set_attribute("error.category", "authentication")
        elif "timeout" in error_message:
            span.set_attribute("error.category", "timeout")
        elif "not found" in error_message:
            span.set_attribute("error.category", "not_found")
        else:
            span.set_attribute("error.category", "unknown")

    except Exception as e:
        logger.debug("Error handling HuggingFace Hub error: %s", e)
