# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment
"""
Module for monitoring Pinecone.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def object_count(obj):
    """
    Counts Length of object if it exists, Else returns None
    """

    if obj:
        return len(obj)

    return None

def general_wrap(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, capture_message_content, metrics, disable_metrics):
    """
    Wraps a Pinecone operation to trace and log its execution metrics.

    This function is intended to wrap around Pinecone operations in order to
    measure their execution time, log relevant information, and trace the execution
    using OpenTelemetry. This helps in monitoring and debugging operations within
    the Pinecone space.

    Parameters:
    - pinecone_operation (str): The specific Pinecone operation being monitored.
                                Examples include 'create_index', 'query', 'upsert', etc.
    - version (str): The version of the application interfacing with Pinecone.
    - environment (str): The deployment environment, such as 'production' or 'development'.
    - application_name (str): The name of the application performing the Pinecone operation.
    - tracer (opentelemetry.trace.Tracer): An object used for OpenTelemetry tracing.
    - pricing_info (dict): Information about pricing, not used in current implementation.
    - capture_message_content (bool): A flag indicating whether the content of responses should be traced.

    Returns:
    - function: A decorator function that, when applied, wraps the target function with
                additional functionality for tracing and logging Pinecone operations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Executes the wrapped Pinecone operation, adding tracing and logging.

        This inner wrapper function captures the execution of Pinecone operations,
        annotating the operation with relevant metrics and tracing information, and
        ensuring any exceptions are caught and logged appropriately.

        Parameters:
        - wrapped (Callable): The Pinecone operation to be wrapped and executed.
        - instance (object): The instance on which the operation is called (for class methods).
        - args (tuple): Positional arguments for the Pinecone operation.
        - kwargs (dict): Keyword arguments for the Pinecone operation.

        Returns:
        - Any: The result of executing the wrapped Pinecone operation.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvention.GEN_AI_ENDPOINT,
                                   gen_ai_endpoint)
                span.set_attribute(DEPLOYMENT_ENVIRONMENT,
                                   environment)
                span.set_attribute(SERVICE_NAME,
                                   application_name)
                span.set_attribute(SemanticConvention.GEN_AI_OPERATION,
                                   SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB)
                span.set_attribute(SemanticConvention.DB_SYSTEM_NAME,
                                   SemanticConvention.DB_SYSTEM_PINECONE)

                if gen_ai_endpoint == "pinecone.create_index":
                    db_operation = SemanticConvention.DB_OPERATION_CREATE_INDEX
                    span.set_attribute(SemanticConvention.DB_OPERATION_NAME,
                                       SemanticConvention.DB_OPERATION_CREATE_INDEX)
                    span.set_attribute(SemanticConvention.DB_INDEX_NAME,
                                       kwargs.get("name", ""))
                    span.set_attribute(SemanticConvention.DB_INDEX_DIMENSION,
                                       kwargs.get("dimensions", ""))
                    span.set_attribute(SemanticConvention.DB_INDEX_METRIC,
                                       kwargs.get("metric", ""))
                    span.set_attribute(SemanticConvention.DB_INDEX_SPEC,
                                       str(kwargs.get("spec", "")))

                elif gen_ai_endpoint == "pinecone.query":
                    db_operation = SemanticConvention.DB_OPERATION_QUERY
                    span.set_attribute(SemanticConvention.DB_OPERATION_NAME,
                                       SemanticConvention.DB_OPERATION_QUERY)
                    span.set_attribute(SemanticConvention.DB_STATEMENT,
                                       str(kwargs.get("vector")))
                    span.set_attribute(SemanticConvention.DB_N_RESULTS,
                                       kwargs.get("top_k", ""))
                    span.set_attribute(SemanticConvention.DB_FILTER,
                                       str(kwargs.get("filter", "")))
                    span.set_attribute(SemanticConvention.DB_NAMESPACE,
                                       str(kwargs.get("namespace", "")))

                elif gen_ai_endpoint == "pinecone.update":
                    db_operation = SemanticConvention.DB_OPERATION_UPDATE
                    span.set_attribute(SemanticConvention.DB_OPERATION_NAME,
                                       SemanticConvention.DB_OPERATION_UPDATE)
                    span.set_attribute(SemanticConvention.DB_UPDATE_ID,
                                       kwargs.get("id",""))
                    span.set_attribute(SemanticConvention.DB_UPDATE_VALUES,
                                       str(kwargs.get("values",[])))
                    span.set_attribute(SemanticConvention.DB_NAMESPACE,
                                       str(kwargs.get("namespace", "")))
                    span.set_attribute(SemanticConvention.DB_UPDATE_METADATA,
                                       str(kwargs.get("set_metadata", "")))

                elif gen_ai_endpoint == "pinecone.upsert":
                    db_operation = SemanticConvention.DB_OPERATION_UPSERT
                    span.set_attribute(SemanticConvention.DB_OPERATION_NAME,
                                       SemanticConvention.DB_OPERATION_UPSERT)
                    span.set_attribute(SemanticConvention.DB_VECTOR_COUNT,
                                       object_count(kwargs.get("vectors")))

                elif gen_ai_endpoint == "pinecone.delete":
                    db_operation = SemanticConvention.DB_OPERATION_DELETE
                    span.set_attribute(SemanticConvention.DB_OPERATION_NAME,
                                       SemanticConvention.DB_OPERATION_DELETE)
                    span.set_attribute(SemanticConvention.DB_ID_COUNT,
                                       object_count(kwargs.get("ids")))
                    span.set_attribute(SemanticConvention.DB_FILTER,
                                       str(kwargs.get("filter", "")))
                    span.set_attribute(SemanticConvention.DB_DELETE_ALL,
                                       kwargs.get("delete_all", False))
                    span.set_attribute(SemanticConvention.DB_NAMESPACE,
                                       kwargs.get("namespace", ""))

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SERVICE_NAME:
                            application_name,
                        SemanticConvention.DB_SYSTEM_NAME:
                            SemanticConvention.DB_SYSTEM_PINECONE,
                        DEPLOYMENT_ENVIRONMENT:
                            environment,
                        SemanticConvention.GEN_AI_OPERATION:
                            SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB,
                        SemanticConvention.DB_OPERATION_NAME:
                            db_operation
                    }

                    metrics["db_requests"].add(1, attributes)

                # Return original response
                return response

            except Exception as e:
                handle_exception(span, e)
                logger.error("Error in trace creation: %s", e)

                # Return original response
                return response

    return wrapper
