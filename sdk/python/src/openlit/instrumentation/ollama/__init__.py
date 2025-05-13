"""
Initializer of Auto Instrumentation of Ollama Functions
"""

from typing import Collection
import importlib.metadata
import sys
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper, when_imported

from openlit.instrumentation.ollama.ollama import (
    chat, embeddings
)
from openlit.instrumentation.ollama.async_ollama import (
    async_chat, async_embeddings
)

_instruments = ("ollama >= 0.2.0",)

# Record modules imported before initialization to apply patches during init
_pending_ollama = []

def _record_module(module):
    _pending_ollama.append(module)

# Record the module whenever ollama is imported
when_imported("ollama")(_record_module)
_existing_mod = sys.modules.get("ollama")
if _existing_mod:
    _record_module(_existing_mod)

class OllamaInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Ollama's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        application_name = kwargs.get("application_name", "default_application")
        environment = kwargs.get("environment", "default_environment")
        tracer = kwargs.get("tracer")
        event_provider = kwargs.get("event_provider")
        metrics = kwargs.get("metrics_dict")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        disable_metrics = kwargs.get("disable_metrics")
        version = importlib.metadata.version("ollama")

        # Define a function to apply wrapt patches based on initialization configuration
        def _apply_instrumentation(module):
            wrap_function_wrapper(
                module, "chat",
                chat(version, environment, application_name,
                     tracer, event_provider, pricing_info,
                     capture_message_content, metrics, disable_metrics),
            )
            wrap_function_wrapper(
                module, "Client.chat",
                chat(version, environment, application_name,
                     tracer, event_provider, pricing_info,
                     capture_message_content, metrics, disable_metrics),
            )
            wrap_function_wrapper(
                module, "embeddings",
                embeddings(version, environment, application_name,
                           tracer, event_provider, pricing_info,
                           capture_message_content, metrics, disable_metrics),
            )
            wrap_function_wrapper(
                module, "Client.embeddings",
                embeddings(version, environment, application_name,
                           tracer, event_provider, pricing_info,
                           capture_message_content, metrics, disable_metrics),
            )
            wrap_function_wrapper(
                module, "AsyncClient.chat",
                async_chat(version, environment, application_name,
                           tracer, event_provider, pricing_info,
                           capture_message_content, metrics, disable_metrics),
            )
            wrap_function_wrapper(
                module, "AsyncClient.embeddings",
                async_embeddings(version, environment, application_name,
                                 tracer, event_provider, pricing_info,
                                 capture_message_content, metrics, disable_metrics),
            )

            # Patch any modules that did `from ollama import chat` before init
            try:
                wrapped_chat = getattr(module, 'chat')
                original_chat = getattr(wrapped_chat, '__wrapped__', None)
                if original_chat:
                    for m in list(sys.modules.values()):
                        if getattr(m, 'chat', None) is original_chat:
                            setattr(m, 'chat', wrapped_chat)
            except Exception:
                pass

            try:
                wrapped_emb = getattr(module, 'embeddings')
                original_emb = getattr(wrapped_emb, '__wrapped__', None)
                if original_emb:
                    for m in list(sys.modules.values()):
                        if getattr(m, 'embeddings', None) is original_emb:
                            setattr(m, 'embeddings', wrapped_emb)
            except Exception:
                pass

        # Apply patches to modules loaded or recorded before initialization
        for mod in _pending_ollama:
            _apply_instrumentation(mod)
        _pending_ollama.clear()
        # Register import-hook for future ollama imports after initialization
        when_imported("ollama")(_apply_instrumentation)

    def _uninstrument(self, **kwargs):
        # Proper uninstrumentation logic to revert patched methods
        pass
