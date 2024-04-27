# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, protected-access
"""
Module for monitoring Anthropic API calls.
"""

import logging
import json
from botocore.response import StreamingBody
from botocore.exceptions import (
    ReadTimeoutError,
    ResponseStreamingError,
)
from urllib3.exceptions import ProtocolError as URLLib3ProtocolError
from urllib3.exceptions import ReadTimeoutError as URLLib3ReadTimeoutError
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import get_chat_model_cost, handle_exception, general_tokens
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

class ReusableStreamingBody(StreamingBody):

    def __init__(self, raw_stream, content_length):
        super().__init__(raw_stream, content_length)
        self._buffer = None
        self._buffer_cursor = 0

    def read(self, amt=None):
        if self._buffer is None:
            try:
                self._buffer = self._raw_stream.read()
            except URLLib3ReadTimeoutError as e:
                raise ReadTimeoutError(endpoint_url=e.url, error=e)
            except URLLib3ProtocolError as e:
                raise ResponseStreamingError(error=e)

            self._amount_read += len(self._buffer)
            if amt is None or (not self._buffer and amt > 0):
                self._verify_content_length()

        if amt is None:
            return self._buffer[self._buffer_cursor:]
        else:
            self._buffer_cursor += amt
            return self._buffer[self._buffer_cursor-amt:self._buffer_cursor]


def chat(gen_ai_endpoint, version, environment, application_name, tracer,
         pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: The monitoring package version.
        environment: Deployment environment (e.g. production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information for calculating OpenAI usage cost.
        trace_content: Whether to trace the actual content.
        metrics: Metrics collector.
        disable_metrics: Flag to toggle metrics collection.
    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps an API call to add telemetry.

        Args:
            wrapped: Original method.
            instance: Instance of the class.
            args: Positional arguments of the 'messages' method.
            kwargs: Keyword arguments of the 'messages' method.
        Returns:
            Response from the original method.
        """

        def add_instrumentation(original_method, *method_args, **method_kwargs):
            """
            Adds instrumentation to the invoke model call.

            Args:
                original_method: The original invoke model method.
                *method_args: Positional arguments for the method.
                **method_kwargs: Keyword arguments for the method.
            Returns:
                The modified response with telemetry.
            """
            with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
                response = original_method(*method_args, **method_kwargs)

                try:
                    # Modify the response body to be reusable
                    response["body"] = ReusableStreamingBody(
                        response["body"]._raw_stream, response["body"]._content_length
                    )
                    request_body = json.loads(method_kwargs.get("body"))
                    response_body = json.loads(response.get("body").read())

                    modelId = method_kwargs.get("modelId", "amazon.titan-text-express-v1")
                    if "stability" in modelId or "image" in modelId:
                        generation = "image"
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_IMAGE)
                    else:
                        generation = "chat"
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)

                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_BEDROCK)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        modelId)
                    if generation == "chat":
                        if "amazon" in modelId:
                            span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                               response_body["inputTextTokenCount"])
                            span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                               response_body["results"][0]["tokenCount"])
                            span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                               response_body["results"][0]["tokenCount"] +
                                               response_body["inputTextTokenCount"])
                            span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                               response_body["results"][0]["completionReason"])

                            # Calculate cost of the operation
                            cost = get_chat_model_cost(modelId,
                                                    pricing_info, response_body["inputTextTokenCount"],
                                                    response_body["results"][0]["tokenCount"])
                            span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)

                            if trace_content:
                                span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_PROMPT,
                                                request_body["inputText"])
                                span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_COMPLETION,
                                                response_body["results"][0]["outputText"])

                        if "mistral" in modelId:
                            prompt_tokens = general_tokens(request_body["prompt"])
                            completion_tokens = general_tokens(response_body["outputs"][0]["text"])
                            span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            prompt_tokens)
                            span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            completion_tokens)
                            span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            prompt_tokens + completion_tokens)
                            span.set_attribute(SemanticConvetion.GEN_AI_RESPONSE_FINISH_REASON,
                                                response_body["outputs"][0]["stop_reason"])
                            # Calculate cost of the operation
                            cost = get_chat_model_cost(modelId,
                                                    pricing_info, prompt_tokens,
                                                    completion_tokens)
                            span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)

                            if trace_content:
                                span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_PROMPT,
                                                request_body["prompt"])
                                span.set_attribute(SemanticConvetion.GEN_AI_CONTENT_COMPLETION,
                                                response_body["outputs"][0]["text"])
                    
                    span.set_status(Status(StatusCode.OK))

                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

        # Get the original client instance from the wrapper
        client = wrapped(*args, **kwargs)

        # Replace the original method with the instrumented one
        original_invoke_model = client.invoke_model
        client.invoke_model = lambda *args, **kwargs: add_instrumentation(original_invoke_model, *args, **kwargs)

        return client

    return wrapper
