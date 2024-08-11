# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, protected-access,  too-many-lines
"""
Module for monitoring VertexAI API calls.
"""

import logging
import math
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import get_chat_model_cost, get_embed_model_cost, handle_exception
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def generate_content(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'generate_content' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'generate_content' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'generate_content' method.
            kwargs: Keyword arguments for the 'generate_content' method.

        Returns:
            The response from the original 'generate_content' method.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    # Loop through streaming events capturing relevant details
                    for event in wrapped(*args, **kwargs):
                        llmresponse += str(event.text)
                        prompt_tokens = event.usage_metadata.prompt_token_count
                        completion_tokens = event.usage_metadata.candidates_token_count
                        total_tokens = event.usage_metadata.total_token_count
                        yield event

                    # Handling exception ensure observability without disrupting operation
                    try:
                        prompt = str(args[0][0])

                        model = "/".join(instance._model_name.split("/")[3:])

                        # Calculate cost of the operation
                        cost = get_chat_model_cost(model,
                                                    pricing_info, prompt_tokens,
                                                    completion_tokens)

                        # Set Span attributes
                        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                            SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                            SemanticConvetion.GEN_AI_TYPE_CHAT)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                            gen_ai_endpoint)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                            environment)
                        span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                            application_name)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                            model)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                            True)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            total_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                            cost)
                        if trace_content:
                            span.add_event(
                                name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                                attributes={
                                    SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                                },
                            )
                            span.add_event(
                                name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                                attributes={
                                    SemanticConvetion.GEN_AI_CONTENT_COMPLETION: llmresponse,
                                },
                            )

                        span.set_status(Status(StatusCode.OK))

                        if disable_metrics is False:
                            attributes = {
                                TELEMETRY_SDK_NAME:
                                    "openlit",
                                SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                    application_name,
                                SemanticConvetion.GEN_AI_SYSTEM:
                                    SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                                SemanticConvetion.GEN_AI_ENVIRONMENT:
                                    environment,
                                SemanticConvetion.GEN_AI_TYPE:
                                    SemanticConvetion.GEN_AI_TYPE_CHAT,
                                SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                    model
                            }

                            metrics["genai_requests"].add(1, attributes)
                            metrics["genai_total_tokens"].add(
                                total_tokens, attributes
                            )
                            metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                            metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                            metrics["genai_cost"].record(cost, attributes)

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in trace creation: %s", e)

            return stream_generator()

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
                response = wrapped(*args, **kwargs)

                try:
                    # Format 'messages' into a single string
                    prompt = str(args[0][0])

                    model = "/".join(instance._model_name.split("/")[3:])
                    # Calculate cost of the operation
                    cost = get_chat_model_cost(model,
                                                pricing_info,
                                                response.usage_metadata.prompt_token_count,
                                                response.usage_metadata.candidates_token_count)

                    # Set Span attribues
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        model)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        response.usage_metadata.prompt_token_count)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        response.usage_metadata.candidates_token_count)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        response.usage_metadata.total_token_count)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                # pylint: disable=line-too-long
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.candidates[0].content.parts[0].text,
                            },
                        )

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                model
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            response.usage_metadata.total_token_count, attributes)
                        metrics["genai_completion_tokens"].add(
                            response.usage_metadata.candidates_token_count, attributes)
                        metrics["genai_prompt_tokens"].add(
                            response.usage_metadata.prompt_token_count, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper


def send_message(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'generate_content' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'generate_content' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'generate_content' method.
            kwargs: Keyword arguments for the 'generate_content' method.

        Returns:
            The response from the original 'generate_content' method.
        """

        # Check if streaming is enabled for the API call
        streaming = kwargs.get("stream", False)

        # pylint: disable=no-else-return
        if streaming:
            # Special handling for streaming response to accommodate the nature of data flow
            def stream_generator():
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Placeholder for aggregating streaming response
                    llmresponse = ""

                    # Loop through streaming events capturing relevant details
                    for event in wrapped(*args, **kwargs):
                        llmresponse += str(event.text)
                        prompt_tokens = event.usage_metadata.prompt_token_count
                        completion_tokens = event.usage_metadata.candidates_token_count
                        total_tokens = event.usage_metadata.total_token_count
                        yield event

                    # Handling exception ensure observability without disrupting operation
                    try:
                        prompt = args[0][0]

                        model = "/".join(instance._model._model_name.split("/")[3:])

                        # Calculate cost of the operation
                        cost = get_chat_model_cost(model,
                                                    pricing_info, prompt_tokens,
                                                    completion_tokens)

                        # Set Span attributes
                        span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                        span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                            SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                        span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                            SemanticConvetion.GEN_AI_TYPE_CHAT)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                            gen_ai_endpoint)
                        span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                            environment)
                        span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                            application_name)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                            model)
                        span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                            True)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                            prompt_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                            completion_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                            total_tokens)
                        span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                            cost)
                        if trace_content:
                            span.add_event(
                                name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                                attributes={
                                    SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                                },
                            )
                            span.add_event(
                                name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                                attributes={
                                    SemanticConvetion.GEN_AI_CONTENT_COMPLETION: llmresponse,
                                },
                            )

                        span.set_status(Status(StatusCode.OK))

                        if disable_metrics is False:
                            attributes = {
                                TELEMETRY_SDK_NAME:
                                    "openlit",
                                SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                    application_name,
                                SemanticConvetion.GEN_AI_SYSTEM:
                                    SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                                SemanticConvetion.GEN_AI_ENVIRONMENT:
                                    environment,
                                SemanticConvetion.GEN_AI_TYPE:
                                    SemanticConvetion.GEN_AI_TYPE_CHAT,
                                SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                    model
                            }

                            metrics["genai_requests"].add(1, attributes)
                            metrics["genai_total_tokens"].add(
                                total_tokens, attributes
                            )
                            metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                            metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                            metrics["genai_cost"].record(cost, attributes)

                    except Exception as e:
                        handle_exception(span, e)
                        logger.error("Error in trace creation: %s", e)

            return stream_generator()

        # Handling for non-streaming responses
        else:
            with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
                response = wrapped(*args, **kwargs)

                try:
                    # Format 'messages' into a single string
                    prompt = args[0]

                    model = "/".join(instance._model._model_name.split("/")[3:])
                    # Calculate cost of the operation
                    cost = get_chat_model_cost(model,
                                                pricing_info,
                                                response.usage_metadata.prompt_token_count,
                                                response.usage_metadata.candidates_token_count)

                    # Set Span attribues
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        model)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        False)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        response.usage_metadata.prompt_token_count)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        response.usage_metadata.candidates_token_count)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        response.usage_metadata.total_token_count)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                # pylint: disable=line-too-long
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.candidates[0].content.parts[0].text,
                            },
                        )

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                model
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            response.usage_metadata.total_token_count, attributes)
                        metrics["genai_completion_tokens"].add(
                            response.usage_metadata.candidates_token_count, attributes)
                        metrics["genai_prompt_tokens"].add(
                            response.usage_metadata.prompt_token_count, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                    # Return original response
                    return response

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

                    # Return original response
                    return response

    return wrapper

def predict(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'predict' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'predict' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'predict' method.
            kwargs: Keyword arguments for the 'predict' method.

        Returns:
            The response from the original 'predict' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                prompt = args[0]

                model = instance._model_id
                #pylint: disable=line-too-long
                prompt_tokens = response._prediction_response.metadata["tokenMetadata"]["inputTokenCount"]["totalTokens"]
                completion_tokens = response._prediction_response.metadata["tokenMetadata"]["outputTokenCount"]["totalTokens"]
                total_tokens = prompt_tokens + completion_tokens

                #Calculate cost of the operation
                cost = get_chat_model_cost(model,
                                            pricing_info, prompt_tokens,
                                            completion_tokens)

                # Set Span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    prompt_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                    completion_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    total_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.text,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            model
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        total_tokens, attributes)
                    metrics["genai_completion_tokens"].add(
                        completion_tokens, attributes)
                    metrics["genai_prompt_tokens"].add(
                        prompt_tokens, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def predict_streaming(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'predict' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'predict' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'predict' method.
            kwargs: Keyword arguments for the 'predict' method.

        Returns:
            The response from the original 'predict' method.
        """

        # Special handling for streaming response to accommodate the nature of data flow
        def stream_generator():
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                # Placeholder for aggregating streaming response
                llmresponse = ""

                # Loop through streaming events capturing relevant details
                for event in wrapped(*args, **kwargs):
                    llmresponse += str(event)
                    yield event

                # Handling exception ensure observability without disrupting operation
                try:
                    prompt = args[0]
                    llmresponse =  llmresponse.split('TextGenerationResponse',
                                                     maxsplit=1)[0].rstrip()

                    prompt_tokens = math.ceil(len(prompt) / 4)
                    completion_tokens = math.ceil(len(llmresponse) / 4)
                    total_tokens = prompt_tokens + completion_tokens

                    model = instance._model_id

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(model,
                                                pricing_info, prompt_tokens,
                                                completion_tokens)

                    # Set Span attributes
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        model)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        True)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        prompt_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        completion_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        total_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: llmresponse,
                            },
                        )

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                model
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            total_tokens, attributes
                        )
                        metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

        return stream_generator()

    return wrapper

def start_chat(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'start_chat' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'start_chat' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'start_chat' method.
            kwargs: Keyword arguments for the 'start_chat' method.

        Returns:
            The response from the original 'start_chat' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
            response =  wrapped(*args, **kwargs)

            try:
                prompt = args[0]

                model = instance._model._model_id

                #pylint: disable=line-too-long
                prompt_tokens = response._prediction_response.metadata["tokenMetadata"]["inputTokenCount"]["totalTokens"]
                completion_tokens = response._prediction_response.metadata["tokenMetadata"]["outputTokenCount"]["totalTokens"]
                total_tokens = prompt_tokens + completion_tokens

                #Calculate cost of the operation
                cost = get_chat_model_cost(model,
                                            pricing_info, prompt_tokens,
                                            completion_tokens)

                # Set Span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_CHAT)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    prompt_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                    completion_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    total_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_COMPLETION: response.text,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_CHAT,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            model
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        total_tokens, attributes)
                    metrics["genai_completion_tokens"].add(
                        completion_tokens, attributes)
                    metrics["genai_prompt_tokens"].add(
                        prompt_tokens, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper

def start_chat_streaming(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'start_chat' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'start_chat' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'start_chat' method.
            kwargs: Keyword arguments for the 'start_chat' method.

        Returns:
            The response from the original 'start_chat' method.
        """

        # Special handling for streaming response to accommodate the nature of data flow
        def stream_generator():
            with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                # Placeholder for aggregating streaming response
                llmresponse = ""

                # Loop through streaming events capturing relevant details
                for event in wrapped(*args, **kwargs):
                    llmresponse += str(event.text)
                    yield event

                # Handling exception ensure observability without disrupting operation
                try:
                    prompt = args[0]

                    prompt_tokens = math.ceil(len(prompt) / 4)
                    completion_tokens = math.ceil(len(llmresponse) / 4)
                    total_tokens = prompt_tokens + completion_tokens

                    model = instance._model._model_id

                    # Calculate cost of the operation
                    cost = get_chat_model_cost(model,
                                                pricing_info, prompt_tokens,
                                                completion_tokens)

                    # Set Span attributes
                    span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                    span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                        SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                    span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                        SemanticConvetion.GEN_AI_TYPE_CHAT)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                        gen_ai_endpoint)
                    span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                        environment)
                    span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                        application_name)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                        model)
                    span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                        True)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                        prompt_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COMPLETION_TOKENS,
                                        completion_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                        total_tokens)
                    span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                        cost)
                    if trace_content:
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                            },
                        )
                        span.add_event(
                            name=SemanticConvetion.GEN_AI_CONTENT_COMPLETION_EVENT,
                            attributes={
                                SemanticConvetion.GEN_AI_CONTENT_COMPLETION: llmresponse,
                            },
                        )

                    span.set_status(Status(StatusCode.OK))

                    if disable_metrics is False:
                        attributes = {
                            TELEMETRY_SDK_NAME:
                                "openlit",
                            SemanticConvetion.GEN_AI_APPLICATION_NAME:
                                application_name,
                            SemanticConvetion.GEN_AI_SYSTEM:
                                SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                            SemanticConvetion.GEN_AI_ENVIRONMENT:
                                environment,
                            SemanticConvetion.GEN_AI_TYPE:
                                SemanticConvetion.GEN_AI_TYPE_CHAT,
                            SemanticConvetion.GEN_AI_REQUEST_MODEL:
                                model
                        }

                        metrics["genai_requests"].add(1, attributes)
                        metrics["genai_total_tokens"].add(
                            total_tokens, attributes
                        )
                        metrics["genai_completion_tokens"].add(completion_tokens, attributes)
                        metrics["genai_prompt_tokens"].add(prompt_tokens, attributes)
                        metrics["genai_cost"].record(cost, attributes)

                except Exception as e:
                    handle_exception(span, e)
                    logger.error("Error in trace creation: %s", e)

        return stream_generator()

    return wrapper

def embeddings(gen_ai_endpoint, version, environment, application_name, tracer,
             pricing_info, trace_content, metrics, disable_metrics):
    """
    Generates a telemetry wrapper for messages to collect metrics.

    Args:
        gen_ai_endpoint: Endpoint identifier for logging and tracing.
        version: Version of the monitoring package.
        environment: Deployment environment (e.g., production, staging).
        application_name: Name of the application using the OpenAI API.
        tracer: OpenTelemetry tracer for creating spans.
        pricing_info: Information used for calculating the cost of OpenAI usage.
        trace_content: Flag indicating whether to trace the actual content.

    Returns:
        A function that wraps the chat method to add telemetry.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Wraps the 'generate_content' API call to add telemetry.

        This collects metrics such as execution time, cost, and token usage, and handles errors
        gracefully, adding details to the trace for observability.

        Args:
            wrapped: The original 'generate_content' method to be wrapped.
            instance: The instance of the class where the original method is defined.
            args: Positional arguments for the 'generate_content' method.
            kwargs: Keyword arguments for the 'generate_content' method.

        Returns:
            The response from the original 'generate_content' method.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind=SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                prompt = args[0][0]

                model = instance._model_id

                prompt_tokens = int(response[0].statistics.token_count)

                #Calculate cost of the operation
                cost = get_embed_model_cost(model,
                                            pricing_info, prompt_tokens)

                # Set Span attribues
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_SYSTEM,
                                    SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                    SemanticConvetion.GEN_AI_TYPE_EMBEDDING)
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                    gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                    environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                    application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_MODEL,
                                    model)
                span.set_attribute(SemanticConvetion.GEN_AI_REQUEST_IS_STREAM,
                                    False)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_PROMPT_TOKENS,
                                    prompt_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_TOTAL_TOKENS,
                                    prompt_tokens)
                span.set_attribute(SemanticConvetion.GEN_AI_USAGE_COST,
                                    cost)
                if trace_content:
                    span.add_event(
                        name=SemanticConvetion.GEN_AI_CONTENT_PROMPT_EVENT,
                        attributes={
                            SemanticConvetion.GEN_AI_CONTENT_PROMPT: prompt,
                        },
                    )

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.GEN_AI_SYSTEM:
                            SemanticConvetion.GEN_AI_SYSTEM_VERTEXAI,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_EMBEDDING,
                        SemanticConvetion.GEN_AI_REQUEST_MODEL:
                            model
                    }

                    metrics["genai_requests"].add(1, attributes)
                    metrics["genai_total_tokens"].add(
                        prompt_tokens, attributes)
                    metrics["genai_prompt_tokens"].add(
                        prompt_tokens, attributes)
                    metrics["genai_cost"].record(cost, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
