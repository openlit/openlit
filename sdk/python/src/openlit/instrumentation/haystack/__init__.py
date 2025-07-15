"""
OpenLIT Haystack Instrumentation
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.haystack.haystack import general_wrap
from openlit.instrumentation.haystack.async_haystack import async_general_wrap

_instruments = ("haystack-ai >= 2.0.0",)

class HaystackInstrumentor(BaseInstrumentor):
    """
    An instrumentor for Haystack's client library.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("haystack-ai")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        # Pipeline operations
        try:
            wrap_function_wrapper(
                "haystack",
                "Pipeline.run",
                general_wrap(
                    "haystack.pipeline_run", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all versions

        try:
            wrap_function_wrapper(
                "haystack",
                "AsyncPipeline.run_async",
                async_general_wrap(
                    "haystack.async_pipeline_run", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all versions

        try:
            wrap_function_wrapper(
                "haystack",
                "AsyncPipeline.run_async_generator",
                async_general_wrap(
                    "haystack.async_generator_run", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all versions

        # Component-level operations (only if detailed_tracing=True)
        if detailed_tracing:
            # Document processing components
            try:
                wrap_function_wrapper(
                    "haystack.components.joiners.document_joiner",
                    "DocumentJoiner.run",
                    general_wrap(
                        "haystack.component.document_joiner", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass  # Module may not exist in all versions

            try:
                wrap_function_wrapper(
                    "haystack.components.preprocessors.document_cleaner",
                    "DocumentCleaner.run",
                    general_wrap(
                        "haystack.component.document_cleaner", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass  # Module may not exist in all versions

            # Retrieval components
            try:
                wrap_function_wrapper(
                    "haystack.components.retrievers.in_memory.bm25_retriever",
                    "InMemoryBM25Retriever.run",
                    general_wrap(
                        "haystack.component.bm25_retriever", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass  # Module may not exist in all versions

            # Generation components
            try:
                wrap_function_wrapper(
                    "haystack.components.generators.openai",
                    "OpenAIGenerator.run",
                    general_wrap(
                        "haystack.component.openai_generator", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass  # Module may not exist in all versions

            # Embedding components
            try:
                wrap_function_wrapper(
                    "haystack.components.embedders.openai_text_embedder",
                    "OpenAITextEmbedder.run",
                    general_wrap(
                        "haystack.component.openai_text_embedder", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass  # Module may not exist in all versions

            # Builder components
            try:
                wrap_function_wrapper(
                    "haystack.components.builders.prompt_builder",
                    "PromptBuilder.run",
                    general_wrap(
                        "haystack.component.prompt_builder", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass  # Module may not exist in all versions

    def _uninstrument(self, **kwargs):
        pass
