"""Initializer of Auto Instrumentation of Together AI Functions"""

from typing import Collection, Sequence
import importlib
import importlib.metadata
from opentelemetry import trace
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit._config import OpenlitConfig
from openlit.instrumentation.together.together import completion, image_generate
from openlit.instrumentation.together.async_together import (
    async_completion,
    async_image_generate,
)

_instruments = ("together >= 1.3.5",)

# together 2.0 renamed every resource class this instrumentor wraps. The 2.x
# name comes first, the 1.x name second, so both layouts stay instrumented
# across the ">= 1.3.5" range declared above.
CHAT_CLASSES = ("CompletionsResource", "ChatCompletions")
ASYNC_CHAT_CLASSES = ("AsyncCompletionsResource", "AsyncChatCompletions")
IMAGE_CLASSES = ("ImagesResource", "Images")
ASYNC_IMAGE_CLASSES = ("AsyncImagesResource", "AsyncImages")


def _wrap_first_present(
    module_path: str, class_names: Sequence[str], method: str, wrapper
) -> bool:
    """Wrap ``<class>.<method>`` for the first candidate that provides it.

    ``wrap_function_wrapper`` resolves the target eagerly, so naming a class
    that no longer exists raises ``PathResolutionError`` and aborts the rest of
    ``_instrument``. Resolving the name here keeps the instrumentor working
    across renames, and skips quietly when no candidate matches.

    A candidate must carry ``method`` to be chosen: during a partial rename a
    release can expose both class names while only one still implements it, and
    picking on class name alone would raise exactly the error this avoids.

    Returns True when a target was wrapped.
    """
    try:
        module = importlib.import_module(module_path)
    except ImportError:
        return False

    for class_name in class_names:
        candidate = getattr(module, class_name, None)
        if candidate is not None and hasattr(candidate, method):
            wrap_function_wrapper(module_path, f"{class_name}.{method}", wrapper)
            return True
    return False


class TogetherInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Together client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default")
        environment = kwargs.get("environment", "default")
        tracer = trace.get_tracer(__name__)
        metrics = OpenlitConfig.metrics_dict
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("together")

        args = (
            version,
            environment,
            application_name,
            tracer,
            pricing_info,
            capture_message_content,
            metrics,
            disable_metrics,
        )

        # Chat completions
        _wrap_first_present(
            "together.resources.chat.completions",
            CHAT_CLASSES,
            "create",
            completion(*args),
        )
        _wrap_first_present(
            "together.resources.chat.completions",
            ASYNC_CHAT_CLASSES,
            "create",
            async_completion(*args),
        )

        # Image generate
        _wrap_first_present(
            "together.resources.images",
            IMAGE_CLASSES,
            "generate",
            image_generate(*args),
        )
        _wrap_first_present(
            "together.resources.images",
            ASYNC_IMAGE_CLASSES,
            "generate",
            async_image_generate(*args),
        )

    def _uninstrument(self, **kwargs):
        pass
