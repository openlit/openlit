# pylint: disable=duplicate-code, line-too-long, broad-exception-caught
"""
Module for monitoring Cohere API calls.
"""

import time
import logging
from ..__helpers import get_chat_model_cost, get_embed_model_cost, handle_exception
from opentelemetry.trace import SpanKind

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

# pylint: disable=too-many-arguments, too-many-statements
def init(llm, environment, application_name, tracer, pricing_info):
    """
    Initializes the instrumentation process by patching the Cohete client
    methods to gather telemetry data during its execution.

    Args:
        llm: Reference to the Cohere client being instrumented.
        environment (str): Identifier for the environment (e.g., 'production', 'development').
        application_name (str): Name of the application using the instrumented client.
        tracer: OpenTelemetry tracer object used for creating spans.
        pricing_info (dict): Contains pricing information for calculating the cost of operations.
    """

    # Backup original functions for later restoration if needed
    original_embed = llm.embed
    original_chat = llm.chat
    original_chat_stream = llm.chat_stream

    def embeddings_generate(*args, **kwargs):
        """
        A patched version of the 'embed' method, enabling telemetry data collection.

        This method wraps the original call to 'embed', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'embed' method.
        """

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = original_embed(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("cohere.embed", kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Get prompt from kwargs and store as a single string
                    prompt = " ".join(kwargs.get("texts", []))

                    # Calculate cost of the operation
                    cost = get_embed_model_cost(kwargs.get("model", "embed-english-v2.0"), pricing_info, response.meta.billed_units.input_tokens)

                    # Set Span attributes
                    span.set_attribute("llm.provider", "Cohere")
                    span.set_attribute("llm.generation", "Embedding")
                    span.set_attribute("llm.endpoint", "cohere.embed")
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "embed-english-v2.0"),)
                    span.set_attribute("llm.prompt", prompt)
                    span.set_attribute("llm.embedding.format", kwargs.get("embedding_types", "float"))
                    span.set_attribute("llm.embedding.dimensions", kwargs.get("input_type", ""))
                    span.set_attribute("llm.user", kwargs.get("user", ""))
                    span.set_attribute("llm.req.id", response.id)
                    span.set_attribute("llm.promptTokens", response.meta.billed_units.input_tokens)
                    span.set_attribute("llm.totalTokens", response.meta.billed_units.input_tokens)
                    span.set_attribute("llm.cost", cost)

                # Return original response
                return response

            except Exception as e:
                handle_exception(tracer, e, "cohere.embed")
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
                handle_exception(tracer, e, "cohere.embed")
                raise e

    def chat_generate(*args, **kwargs):
        """
        A patched version of the 'chat' method, enabling telemetry data collection.

        This method wraps the original call to 'chat', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'chat' method.
        """

        # Sections handling exceptions ensure observability without disrupting operations
        try:
            start_time = time.time()
            response = original_chat(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span("cohere.chat", kind=SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(kwargs.get("model", "command"), pricing_info, response.meta["billed_units"]["input_tokens"], response.meta["billed_units"]["output_tokens"])

                    # Set Span attributes
                    span.set_attribute("llm.provider", "Cohere")
                    span.set_attribute("llm.generation", "chat")
                    span.set_attribute("llm.endpoint", "cohere.chat")
                    span.set_attribute("llm.environment", environment)
                    span.set_attribute("llm.application.name", application_name)
                    span.set_attribute("llm.request.duration", duration)
                    span.set_attribute("llm.model", kwargs.get("model", "command"))
                    span.set_attribute("llm.temperature", kwargs.get("temperature", 0.3))
                    span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                    span.set_attribute("llm.seed", kwargs.get("seed", ""))
                    span.set_attribute("llm.frequency.penalty", kwargs.get("frequency_penalty", 0.0))
                    span.set_attribute("llm.presence.penalty", kwargs.get("presence_penalty", 0.0))
                    span.set_attribute("llm.stream", False)
                    span.set_attribute("llm.prompt", kwargs.get("message", ""))
                    span.set_attribute("llm.req.id", response.response_id)
                    span.set_attribute("llm.finish.reason", response.response_id)
                    span.set_attribute("llm.response", response.text)
                    span.set_attribute("llm.promptTokens", response.meta["billed_units"]["input_tokens"])
                    span.set_attribute("llm.completionTokens", response.meta["billed_units"]["output_tokens"])
                    span.set_attribute("llm.totalTokens", response.token_count["billed_tokens"])
                    span.set_attribute("llm.cost", cost)

                # Return original response
                return response

            except Exception as e:
                    handle_exception(tracer, e, "cohere.chat")
                    logger.error("Error in patched message creation: %s", e)

                    # Return original response
                    return response

        except Exception as e:
                handle_exception(tracer, e, "cohere.chat")
                raise e

    # pylint: disable=too-many-locals
    def patched_chat_stream(*args, **kwargs):
        """
        A patched version of the 'chat_stream' method, enabling telemetry data collection.

        This method wraps the original call to 'chat_stream', adding a telemetry layer that
        captures execution time, error handling, and other metrics.

        Args:
            *args: Variable positional arguments passed to the original method.
            **kwargs: Variable keyword arguments passed to the original method.

        Returns:
            The response from the original 'chat_stream' method.
        """

        # Record start time for measuring request duration
        start_time = time.time()

        def stream_generator():
            # Placeholder for aggregating streaming response
            llmresponse = ""

            try:
                # Loop through streaming events capturing relevant details
                for event in original_chat_stream(*args, **kwargs):
                    # Collect message IDs and aggregated response from events
                    if event.event_type == "stream-end":
                        llmresponse = event.response.text
                        response_id = event.response.response_id
                        prompt_tokens = event.response.meta["billed_units"]["input_tokens"]
                        completion_tokens = event.response.meta["billed_units"]["output_tokens"]
                        total_tokens = event.response.token_count["billed_tokens"]
                        finish_reason = event.finish_reason
                    yield event

                # Sections handling exceptions ensure observability without disrupting operations
                try:
                    with tracer.start_as_current_span("cohere.chat", kind= SpanKind.CLIENT) as span:
                        end_time = time.time()
                        # Calculate total duration of operation
                        duration = end_time - start_time

                        # Calculate cost of the operation
                        cost = get_chat_model_cost(kwargs.get("model", "command"), pricing_info, prompt_tokens, completion_tokens)

                        # Set Span attributes
                        span.set_attribute("llm.provider", "Cohere")
                        span.set_attribute("llm.generation", "chat")
                        span.set_attribute("llm.endpoint", "cohere.chat")
                        span.set_attribute("llm.environment", environment)
                        span.set_attribute("llm.application.name", application_name)
                        span.set_attribute("llm.request.duration", duration)
                        span.set_attribute("llm.model", kwargs.get("model", "command"))
                        span.set_attribute("llm.temperature", kwargs.get("temperature", 0.3))
                        span.set_attribute("llm.max.tokens", kwargs.get("max_tokens", ""))
                        span.set_attribute("llm.seed", kwargs.get("seed", ""))
                        span.set_attribute("llm.frequency.penalty", kwargs.get("frequency_penalty", 0.0))
                        span.set_attribute("llm.presence.penalty", kwargs.get("presence_penalty", 0.0))
                        span.set_attribute("llm.stream", True)
                        span.set_attribute("llm.prompt", kwargs.get("message", ""))
                        span.set_attribute("llm.req.id", response_id)
                        span.set_attribute("llm.finish.reason", finish_reason)
                        span.set_attribute("llm.response", llmresponse)
                        span.set_attribute("llm.promptTokens", prompt_tokens)
                        span.set_attribute("llm.completionTokens", completion_tokens)
                        span.set_attribute("llm.totalTokens", total_tokens)
                        span.set_attribute("llm.cost", cost)

                except Exception as e:
                    handle_exception(tracer, e, "cohere.chat")
                    logger.error("Error in patched message creation: %s", e)

            except Exception as e:
                handle_exception(tracer, e, "cohere.chat")
                raise e

        return stream_generator()

    llm.embed = embeddings_generate
    llm.chat = chat_generate
    llm.chat_stream = patched_chat_stream
