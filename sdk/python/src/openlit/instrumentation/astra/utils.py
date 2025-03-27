"""
Astra OpenTelemetry instrumentation utility functions
"""

import time
import logging
from opentelemetry.trace import Status, StatusCode
from opentelemetry.sdk.resources import SERVICE_NAME, TELEMETRY_SDK_NAME, DEPLOYMENT_ENVIRONMENT
from openlit.__helpers import handle_exception
from openlit.semcov import SemanticConvention

# Initialize logger for logging potential issues and operations
logger = logging.getLogger(__name__)

def object_count(obj):
    """Counts Length of object if it exists, Else returns None."""
    return len(obj) if isinstance(obj, list) else 1

DB_OPERATION_MAP = {
    'astra.create_collection': SemanticConvention.DB_OPERATION_CREATE_COLLECTION,
    'astra.drop_collection': SemanticConvention.DB_OPERATION_DELETE_COLLECTION,
    'astra.insert': SemanticConvention.DB_OPERATION_INSERT,
    'astra.update': SemanticConvention.DB_OPERATION_UPDATE,
    'astra.find': SemanticConvention.DB_OPERATION_SELECT,
    'astra.find_one_and_update': SemanticConvention.DB_OPERATION_REPLACE,
    'astra.replace_one': SemanticConvention.DB_OPERATION_REPLACE,
    'astra.delete': SemanticConvention.DB_OPERATION_DELETE,
    'astra.find_one_and_delete': SemanticConvention.DB_OPERATION_FIND_AND_DELETE
}

def process_db_operations(response, span, start_time, gen_ai_endpoint,
        version, environment, application_name,
        capture_message_content, metrics, disable_metrics, server_address,
        server_port, collection_name, db_operation, kwargs, args):
    """
    Process DB operation and generate Telemetry
    """

    end_time = time.time()

    try:
        span.set_attribute(TELEMETRY_SDK_NAME, 'openlit')
        span.set_attribute(SemanticConvention.GEN_AI_OPERATION, SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB)
        span.set_attribute(SemanticConvention.DB_SYSTEM_NAME, SemanticConvention.DB_SYSTEM_ASTRA)
        span.set_attribute(SemanticConvention.DB_CLIENT_OPERATION_DURATION, end_time - start_time)
        span.set_attribute(SemanticConvention.SERVER_ADDRESS, server_address)
        span.set_attribute(SemanticConvention.SERVER_PORT, server_port)
        span.set_attribute(DEPLOYMENT_ENVIRONMENT, environment)
        span.set_attribute(SERVICE_NAME, application_name)
        span.set_attribute(SemanticConvention.DB_OPERATION_NAME, db_operation)
        span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, collection_name)
        span.set_attribute(SemanticConvention.DB_SDK_VERSION, version)

        if db_operation == SemanticConvention.DB_OPERATION_CREATE_COLLECTION:
            span.set_attribute(SemanticConvention.DB_NAMESPACE, response.keyspace)
            span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, response.name)
            span.set_attribute(SemanticConvention.DB_INDEX_DIMENSION, kwargs.get('dimension', ''))
            span.set_attribute(SemanticConvention.DB_INDEX_METRIC, str(kwargs.get('metric', '')))

        if db_operation == SemanticConvention.DB_OPERATION_INSERT:
            span.set_attribute(SemanticConvention.DB_DOCUMENTS_COUNT, object_count(args[0]))
            span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(args[0] or kwargs.get('documents', {})))

        elif db_operation == SemanticConvention.DB_OPERATION_UPDATE:
            span.set_attribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, response.update_info.get('nModified', 0))
            span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(args[1] or kwargs.get('update', {})))

        elif db_operation == SemanticConvention.DB_OPERATION_DELETE:
            span.set_attribute(SemanticConvention.DB_RESPONSE_RETURNED_ROWS, response.deleted_count)
            span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(args[0] or kwargs.get('filter', {})))

        elif db_operation in [
            SemanticConvention.DB_OPERATION_SELECT,
            SemanticConvention.DB_OPERATION_FIND_AND_DELETE,
            SemanticConvention.DB_OPERATION_REPLACE
        ]:
            span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(args or kwargs.get('filter', {})))

        span.set_status(Status(StatusCode.OK))

        if not disable_metrics:
            attributes = {
                TELEMETRY_SDK_NAME: 'openlit',
                SERVICE_NAME: application_name,
                SemanticConvention.DB_SYSTEM_NAME: SemanticConvention.DB_SYSTEM_ASTRA,
                DEPLOYMENT_ENVIRONMENT: environment,
                SemanticConvention.GEN_AI_OPERATION: SemanticConvention.GEN_AI_OPERATION_TYPE_VECTORDB,
                SemanticConvention.DB_OPERATION_NAME: db_operation
            }

            metrics['db_requests'].add(1, attributes)
            metrics['db_client_operation_duration'].record(end_time - start_time, attributes)

        # Return original response
        return response

    except Exception as e:
        handle_exception(span, e)
        logger.error('Error in trace creation: %s', e)

        # Return original response
        return response
