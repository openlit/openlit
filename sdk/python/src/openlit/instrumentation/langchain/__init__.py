"""
OpenLIT LangChain Instrumentation - Callback-Based Hierarchical Spans
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.langchain.callback_handler import (
    OpenLITLangChainCallbackHandler,
)

_instruments = ("langchain >= 0.1.20",)


class CallbackManagerWrapper:  # pylint: disable=too-few-public-methods
    """Wrapper to inject OpenLIT callback handler into LangChain's callback system"""

    def __init__(self, callback_handler: OpenLITLangChainCallbackHandler):
        self.callback_handler = callback_handler

    def __call__(self, wrapped, instance, args, kwargs):
        """Inject OpenLIT callback handler when BaseCallbackManager is initialized"""

        # Call original initialization
        wrapped(*args, **kwargs)

        # Check if our callback handler is already registered
        for handler in instance.inheritable_handlers:
            if isinstance(handler, type(self.callback_handler)):
                break
        else:
            # Add our callback handler to the manager
            instance.add_handler(self.callback_handler, True)


class LangChainInstrumentor(BaseInstrumentor):
    """
    OpenLIT LangChain instrumentor using callback-based hierarchical span creation.

    This approach hooks into LangChain's built-in callback system to create
    proper parent-child span relationships automatically, providing superior
    observability with OpenLIT's comprehensive business intelligence.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("langchain")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")

        # Create OpenLIT callback handler with all configuration
        openlit_callback_handler = OpenLITLangChainCallbackHandler(
            tracer=tracer,
            version=version,
            environment=environment,
            application_name=application_name,
            pricing_info=pricing_info,
            capture_message_content=capture_message_content,
            metrics=metrics,
            disable_metrics=disable_metrics,
        )

        # Hook into LangChain's callback system
        # This automatically provides hierarchical spans for:
        # - RunnableSequence (workflow spans)
        # - PromptTemplate (task spans)
        # - ChatOpenAI (chat spans)
        # - Tools, Retrievers, etc.
        try:
            wrap_function_wrapper(
                module="langchain_core.callbacks",
                name="BaseCallbackManager.__init__",
                wrapper=CallbackManagerWrapper(openlit_callback_handler),
            )
        except Exception:
            # Graceful degradation if callback system unavailable
            pass

        # Result: Best of both worlds - hierarchy + business intelligence

    def _uninstrument(self, **kwargs):
        """Remove instrumentation"""
        try:
            from opentelemetry.instrumentation.utils import unwrap

            unwrap("langchain_core.callbacks", "BaseCallbackManager.__init__")
        except Exception:
            pass
