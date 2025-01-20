# pylint: disable=duplicate-code, broad-exception-caught, too-many-statements, unused-argument, possibly-used-before-assignment, too-many-branches
"""
Module for monitoring AstraDB.
"""

import logging
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.sdk.resources import TELEMETRY_SDK_NAME
from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvetion

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def object_count(obj):
    """
    Counts Length of object if it exists, Else returns None
    """

    return len(obj) if obj else None

def general_wrap(gen_ai_endpoint, version, environment, application_name,
                 tracer, pricing_info, trace_content, metrics, disable_metrics):
    """
    Wraps a AstraDB operation to trace and log its execution metrics.

    This function is intended to wrap around AstraDB operations in order to
    measure their execution time, log relevant information, and trace the execution
    using OpenTelemetry. This helps in monitoring and debugging operations within
    the AstraDB space.

    Parameters:
    - operation (str): The specific AstraDB operation being monitored.
                                Examples include 'create_index', 'query', 'upsert', etc.
    - version (str): The version of the application interfacing with AstraDB.
    - environment (str): The deployment environment, such as 'production' or 'development'.
    - application_name (str): The name of the application performing the AstraDB operation.
    - tracer (opentelemetry.trace.Tracer): An object used for OpenTelemetry tracing.
    - pricing_info (dict): Information about pricing, not used in current implementation.
    - trace_content (bool): A flag indicating whether the content of responses should be traced.

    Returns:
    - function: A decorator function that, when applied, wraps the target function with
                additional functionality for tracing and logging AstraDB operations.
    """

    def wrapper(wrapped, instance, args, kwargs):
        """
        Executes the wrapped AstraDB operation, adding tracing and logging.

        This inner wrapper function captures the execution of AstraDB operations,
        annotating the operation with relevant metrics and tracing information, and
        ensuring any exceptions are caught and logged appropriately.

        Parameters:
        - wrapped (Callable): The AstraDB operation to be wrapped and executed.
        - instance (object): The instance on which the operation is called (for class methods).
        - args (tuple): Positional arguments for the AstraDB operation.
        - kwargs (dict): Keyword arguments for the AstraDB operation.

        Returns:
        - Any: The result of executing the wrapped AstraDB operation.
        """

        with tracer.start_as_current_span(gen_ai_endpoint, kind= SpanKind.CLIENT) as span:
            response = wrapped(*args, **kwargs)

            try:
                span.set_attribute(TELEMETRY_SDK_NAME, "openlit")
                span.set_attribute(SemanticConvetion.GEN_AI_ENDPOINT,
                                   gen_ai_endpoint)
                span.set_attribute(SemanticConvetion.GEN_AI_ENVIRONMENT,
                                   environment)
                span.set_attribute(SemanticConvetion.GEN_AI_APPLICATION_NAME,
                                   application_name)
                span.set_attribute(SemanticConvetion.GEN_AI_TYPE,
                                   SemanticConvetion.GEN_AI_TYPE_VECTORDB)
                span.set_attribute(SemanticConvetion.DB_SYSTEM,
                                   SemanticConvetion.DB_SYSTEM_ASTRA)

                if gen_ai_endpoint == "astra.create_collection":
                    db_operation = SemanticConvetion.DB_OPERATION_CREATE_COLLECTION
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       response.name)
                    span.set_attribute(SemanticConvetion.DB_INDEX_DIMENSION,
                                       kwargs.get("dimension", ""))
                    span.set_attribute(SemanticConvetion.DB_INDEX_METRIC,
                                       str(kwargs.get("metric", "")))
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                        instance.api_endpoint)

                elif gen_ai_endpoint == "astra.drop_collection":
                    db_operation = SemanticConvetion.DB_OPERATION_DELETE_COLLECTION
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       kwargs.get("name_or_collection", ""))
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.api_endpoint)

                elif gen_ai_endpoint == "astra.insert_one":
                    db_operation = SemanticConvetion.DB_OPERATION_INSERT
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       instance.name)
                    span.set_attribute(SemanticConvetion.DB_DOCUMENTS_COUNT,
                                       1)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.database.api_endpoint)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_ID,
                                       response.inserted_id)

                elif gen_ai_endpoint == "astra.insert_many":
                    db_operation = SemanticConvetion.DB_OPERATION_INSERT
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_DOCUMENTS_COUNT,
                                       object_count(args[0]))
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       instance.name)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.database.api_endpoint)

                elif gen_ai_endpoint in ["astra.update_one", "astra.update_many"]:
                    db_operation = SemanticConvetion.DB_OPERATION_UPDATE
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       instance.name)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.database.api_endpoint)
                    span.set_attribute(SemanticConvetion.DB_DOCUMENTS_COUNT,
                                       response.update_info.get("nModified", 0))

                elif gen_ai_endpoint == "astra.find_one_and_update":
                    db_operation = SemanticConvetion.DB_OPERATION_UPDATE
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       instance.name)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.database.api_endpoint)

                elif gen_ai_endpoint == "astra.find":
                    db_operation = SemanticConvetion.DB_OPERATION_QUERY
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       instance.name)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.database.api_endpoint)
                    span.set_attribute(SemanticConvetion.DB_STATEMENT,
                                       str(args))

                elif gen_ai_endpoint == "astra.replace_one":
                    if kwargs.get("upsert") is True:
                        db_operation = SemanticConvetion.DB_OPERATION_UPSERT
                    else:
                        db_operation = SemanticConvetion.DB_OPERATION_REPLACE
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       instance.name)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.database.api_endpoint)
                    span.set_attribute(SemanticConvetion.DB_STATEMENT,
                                       str(args))

                elif gen_ai_endpoint in ["astra.delete_one", "astra.delete_many"]:
                    db_operation = SemanticConvetion.DB_OPERATION_DELETE
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       instance.name)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.database.api_endpoint)
                    span.set_attribute(SemanticConvetion.DB_STATEMENT,
                                       str(args))
                    span.set_attribute(SemanticConvetion.DB_DOCUMENTS_COUNT,
                                       response.deleted_count)

                elif gen_ai_endpoint == "astra.find_one_and_delete":
                    db_operation = SemanticConvetion.DB_OPERATION_DELETE
                    span.set_attribute(SemanticConvetion.DB_OPERATION,
                                       db_operation)
                    span.set_attribute(SemanticConvetion.DB_COLLECTION_NAME,
                                       instance.name)
                    span.set_attribute(SemanticConvetion.DB_OPERATION_API_ENDPOINT,
                                       instance.database.api_endpoint)
                    span.set_attribute(SemanticConvetion.DB_STATEMENT,
                                       str(args))

                span.set_status(Status(StatusCode.OK))

                if disable_metrics is False:
                    attributes = {
                        TELEMETRY_SDK_NAME:
                            "openlit",
                        SemanticConvetion.GEN_AI_APPLICATION_NAME:
                            application_name,
                        SemanticConvetion.DB_SYSTEM:
                            SemanticConvetion.DB_SYSTEM_ASTRA,
                        SemanticConvetion.GEN_AI_ENVIRONMENT:
                            environment,
                        SemanticConvetion.GEN_AI_TYPE:
                            SemanticConvetion.GEN_AI_TYPE_VECTORDB,
                        SemanticConvetion.DB_OPERATION:
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
