# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument
"""
Module for monitoring Langchain aapplications.
"""

import time
import logging
from opentelemetry.trace import SpanKind
from ..__helpers import get_chat_model_cost, get_embed_model_cost, handle_exception

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def general_wrap(gen_ai_endpoint, version, environment, application_name, tracer,pricing_info, trace_content):

    def wrapper(wrapped, instance, args, kwargs):

        try:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    span.set_attribute("gen_ai.system", "langchain")
                    span.set_attribute("gen_ai.type", "retrieval")
                    span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request_duration", duration)
                    span.set_attribute("gen_ai.retrieval.source", response[0].metadata["source"])
                
                return response

            except Exception as e:
                handle_exception(tracer, e, gen_ai_endpoint)
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, gen_ai_endpoint)
            raise e

    return wrapper

def hub(gen_ai_endpoint, version, environment, application_name, tracer,pricing_info, trace_content):

    def wrapper(wrapped, instance, args, kwargs):

        try:
            start_time = time.time()
            response = wrapped(*args, **kwargs)
            end_time = time.time()

            try:
                with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
                    # Calculate total duration of operation
                    duration = end_time - start_time

                    span.set_attribute("gen_ai.system", "langchain")
                    span.set_attribute("gen_ai.type", "retrieval")
                    span.set_attribute("gen_ai.endpoint", gen_ai_endpoint)
                    span.set_attribute("gen_ai.environment", environment)
                    span.set_attribute("gen_ai.application_name", application_name)
                    span.set_attribute("gen_ai.request_duration", duration)
                    span.set_attribute("gen_ai.hub.owner", response.metadata["lc_hub_owner"])
                    span.set_attribute("gen_ai.hub.repo", response.metadata["lc_hub_repo"])
                
                return response

            except Exception as e:
                handle_exception(tracer, e, gen_ai_endpoint)
                logger.error("Error in patched message creation: %s", e)

                # Return original response
                return response

        except Exception as e:
            handle_exception(tracer, e, gen_ai_endpoint)
            raise e

    return wrapper




 
