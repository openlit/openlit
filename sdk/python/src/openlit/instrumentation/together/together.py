"""
Module for monitoring Together API calls.
"""

import logging
import time
from opentelemetry.trace import SpanKind
from openlit.__helpers import (
    handle_exception,
    set_server_address_and_port
)
from openlit.instrumentation.together.utils import (
    process_chat_response,
    process_chunk,
    process_streaming_chat_response
)
from openlit.semcov import SemanticConvention

def completion(version, environment, application_name,
    tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for GenAI function call
    """

    class TracedSyncStream:
        """
        Wrapper for streaming responses to collect telemetry.
        """

        def __init__(
                self,
                wrapped,
                span,
                span_name,
                kwargs,
                server_address,
                server_port,
                **args,
            ):
            self.__wrapped__ = wrapped
            self._span = span
            self._span_name = span_name
            self._llmresponse = ""
            self._response_id = ""
            self._response_model = ""
            self._input_tokens = 0
            self._output_tokens = 0
            self._finish_reason = ""
            self._tools = None
            self._args = args
            self._kwargs = kwargs
            self._start_time = time.time()
            self._end_time = None
            self._timestamps = []
            self._ttft = 0
            self._tbt = 0
            self._server_address = server_address
            self._server_port = server_port

        def __enter__(self):
            self.__wrapped__.__enter__()
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            self.__wrapped__.__exit__(exc_type, exc_value, traceback)

        def __iter__(self):
            return self

        def __getattr__(self, name):
            """Delegate attribute access to the wrapped object."""
            return getattr(self.__wrapped__, name)

        def __next__(self):
            try:
                chunk = self.__wrapped__.__next__()
                process_chunk(self, chunk)
                return chunk
            except StopIteration:
                try:
                    with tracer.start_as_current_span(self._span_name, kind= SpanKind.CLIENT) as self._span:
                        process_streaming_chat_response(
                            self,
                            pricing_info=pricing_info,
                            environment=environment,
                            application_name=application_name,
                            metrics=metrics,
                            capture_message_content=capture_message_content,
                            disable_metrics=disable_metrics,
                            version=version
                        )

                except Exception as e:
                    handle_exception(self._span, e)

                raise

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the GenAI function call.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)

        server_address, server_port = set_server_address_and_port(instance, "api.together.xyz", 443)
        request_model = kwargs.get("model", "gpt-4o")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT} {request_model}"

        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            awaited_wrapped = wrapped(*args, **kwargs)
            span = tracer.start_span(span_name, kind=SpanKind.CLIENT)
            return TracedSyncStream(awaited_wrapped, span, span_name, kwargs, server_address, server_port)

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
                start_time = time.time()
                response = wrapped(*args, **kwargs)

                try:
                    response = process_chat_response(
                        response=response,
                        request_model=request_model,
                        pricing_info=pricing_info,
                        server_port=server_port,
                        server_address=server_address,
                        environment=environment,
                        application_name=application_name,
                        metrics=metrics,
                        start_time=start_time,
                        span=span,
                        capture_message_content=capture_message_content,
                        disable_metrics=disable_metrics,
                        version=version,
                        **kwargs
                    )

                except Exception as e:
                    handle_exception(span, e)

                return response

    return wrapper

def image_generate(version, environment, application_name,
                   tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for image generation to collect metrics.
    
    Args:
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the Together AI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of Together AI image generation.
        capture_message_content: Flag indicating whether to trace the input prompt and generated images.
    
    Returns:
        A function that wraps the image generation method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'images.generate' API call to add telemetry.

        This collects metrics such as execution time, cost, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'images.generate' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'images.generate' method.
            kwargs: Keyword arguments for the 'images.generate' method.

        Returns:
            The response from the original 'images.generate' method.
        """

        server_address, server_port = set_server_address_and_port(instance, "api.together.xyz", 443)
        request_model = kwargs.get("model", "dall-e-2")

        span_name = f"{SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE} {request_model}"

        with tracer.start_as_current_span(span_name, kind= SpanKind.CLIENT) as span:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            images_count = 0

            try:
                # Find Image format
                if "response_format" in kwargs and kwargs["response_format"] == "b64_json":
                    image = "b64_json"
                else:
                    image = "url"

                image_size = str(kwargs.get('width')) + 'x' + str(kwargs.get('height'))

                # Calculate cost of the operation
                cost = get_image_model_cost(request_model,
                                            pricing_info, image_size,
                                            kwargs.get("quality", "standard"))

                for items in response.data:
                    # Set Span attributes (OTel Semconv)
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                        SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE)
                    span.set_attribute(SemanticConvention.GEN_AI_SYSTEM,
                                        SemanticConvention.GEN_AI_SYSTEM_TOGETHER)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_MODEL,
                                        request_model)
                    span.set_attribute(SemanticConvention.SERVER_ADDRESS,
                                        server_address)
                    span.set_attribute(SemanticConvention.SERVER_PORT,
                                        server_port)
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_ID,
                                        response.id)
                    span.set_attribute(SemanticConvention.GEN_AI_RESPONSE_MODEL,
                                        response.model)
                    span.set_attribute(SemanticConvention.GEN_AI_OUTPUT_TYPE,
                                        "image")

                    # Set Span attributes (Extras)
                    span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SERVICE_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvention.GEN_AI_REQUEST_IMAGE_SIZE,
                                        image_size)
                    span.set_attribute(SemanticConvention.GEN_AI_SDK_VERSION,
                                        version)

                    if capture_message_content:
                        span.add_event(
                            name=SemanticConvention.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_PROMPT: kwargs.get("prompt", ""),
                            },
                        )
                        attribute_name = f"{SemanticConvention.GEN_AI_RESPONSE_IMAGE}.{images_count}"
                        span.add_event(
                            name=attribute_name,
                            attributes={
                                SemanticConvention.GEN_AI_CONTENT_COMPLETION: getattr(items, image),
                            },
                        )

                    images_count+=1

                span.set_attribute(SemanticConvention.GEN_AI_USAGE_COST,
                                    len(response.data) * cost)
                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = create_metrics_attributes(
                        service_name=application_name,
                        deployment_environment=environment,
                        operation=SemanticConvention.GEN_AI_OPERATION_TYPE_IMAGE,
                        system=SemanticConvention.GEN_AI_SYSTEM_TOGETHER,
                        request_model=request_model,
                        server_address=server_address,
                        server_port=server_port,
                        response_model=response.model,
                    )

                    metrics["genai_client_operation_duration"].record(
                        end_time - start_time, attributes
                    )
                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)

                # Return original response
                return response

    return wrapper
