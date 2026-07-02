"""
Utilities for Elasticsearch instrumentation.
"""

import time
from opentelemetry.trace import Status, StatusCode
from openlit.__helpers import (
    common_db_span_attributes,
    record_db_metrics,
)
from openlit.semcov import SemanticConvention

# Operation mapping for Elasticsearch endpoints
DB_OPERATION_MAP = {
    "elasticsearch.search": SemanticConvention.DB_OPERATION_QUERY,
    "elasticsearch.msearch": SemanticConvention.DB_OPERATION_QUERY,
    "elasticsearch.index": SemanticConvention.DB_OPERATION_INSERT,
    "elasticsearch.bulk": SemanticConvention.DB_OPERATION_INSERT,
    "elasticsearch.get": SemanticConvention.DB_OPERATION_GET,
    "elasticsearch.mget": SemanticConvention.DB_OPERATION_GET,
    "elasticsearch.update": SemanticConvention.DB_OPERATION_UPDATE,
    "elasticsearch.delete": SemanticConvention.DB_OPERATION_DELETE,
    "elasticsearch.indices.create": SemanticConvention.DB_OPERATION_CREATE_INDEX,
    "elasticsearch.indices.delete": SemanticConvention.DB_OPERATION_DELETE_COLLECTION,
}


def object_count(obj):
    """Returns length of object if it exists, else 0."""
    try:
        return len(obj)
    except (TypeError, AttributeError):
        return 0


def set_server_address_and_port(instance):
    """
    Extracts server address and port from an Elasticsearch client instance.

    Args:
        instance: Elasticsearch client instance

    Returns:
        tuple: (server_address, server_port)
    """
    server_address = "localhost"
    server_port = 9200

    try:
        # IndicesClient stores the parent Elasticsearch client as _client
        actual = getattr(instance, "_client", instance)
        transport = getattr(actual, "transport", None) or getattr(actual, "_transport", None)
        if transport is None:
            return server_address, server_port

        # elasticsearch-py v8/v9: transport.node_pool.all() yields node objects
        node_pool = getattr(transport, "node_pool", None)
        if node_pool is not None and callable(getattr(node_pool, "all", None)):
            nodes = list(node_pool.all())
            if nodes:
                node = nodes[0]
                # Prefer node.config (NodeConfig dataclass, v8+)
                config = getattr(node, "config", None)
                if config is not None:
                    server_address = getattr(config, "host", server_address) or server_address
                    server_port = int(getattr(config, "port", server_port) or server_port)
                else:
                    # Fallback: direct attributes on the node
                    server_address = getattr(node, "host", server_address) or server_address
                    server_port = int(getattr(node, "port", server_port) or server_port)
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    return server_address, server_port


def common_elasticsearch_logic(
    scope,
    environment,
    application_name,
    metrics,
    capture_message_content,
    disable_metrics,
    version,
    endpoint=None,
):
    """Process an Elasticsearch operation and emit telemetry."""
    # pylint: disable=too-many-arguments, too-many-positional-arguments
    # pylint: disable=too-many-branches, too-many-statements
    scope._end_time = time.time()

    common_db_span_attributes(
        scope,
        SemanticConvention.DB_SYSTEM_ELASTICSEARCH,
        scope._server_address,
        scope._server_port,
        environment,
        application_name,
        version,
    )

    scope._span.set_attribute(SemanticConvention.DB_OPERATION_NAME, scope._db_operation)
    scope._span.set_attribute(
        SemanticConvention.DB_CLIENT_OPERATION_DURATION,
        scope._end_time - scope._start_time,
    )

    index = scope._kwargs.get("index", "unknown")

    if scope._db_operation == SemanticConvention.DB_OPERATION_QUERY:
        if endpoint == "elasticsearch.search":
            body = scope._kwargs.get("body") or scope._kwargs.get("query") or {}
            size = scope._kwargs.get("size", 10)

            scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
            if capture_message_content:
                scope._span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(body))
            scope._span.set_attribute(SemanticConvention.DB_VECTOR_QUERY_TOP_K, size)
            scope._span.set_attribute(
                SemanticConvention.DB_QUERY_SUMMARY,
                f"search {index} size={size}",
            )

        elif endpoint == "elasticsearch.msearch":
            searches = scope._kwargs.get("body") or scope._kwargs.get("searches") or []
            count = object_count(searches) // 2  # header+body pairs

            scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
            if capture_message_content:
                scope._span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(searches))
            scope._span.set_attribute(
                SemanticConvention.DB_QUERY_SUMMARY,
                f"msearch {index} queries={count}",
            )

    elif scope._db_operation == SemanticConvention.DB_OPERATION_INSERT:
        if endpoint == "elasticsearch.index":
            document = scope._kwargs.get("document") or scope._kwargs.get("body") or {}

            scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
            if capture_message_content:
                scope._span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(document))
            scope._span.set_attribute(
                SemanticConvention.DB_QUERY_SUMMARY,
                f"index {index}",
            )

        elif endpoint == "elasticsearch.bulk":
            operations = scope._kwargs.get("operations") or scope._kwargs.get("body") or []
            op_count = object_count(operations)

            scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
            scope._span.set_attribute(SemanticConvention.DB_VECTOR_COUNT, op_count)
            scope._span.set_attribute(
                SemanticConvention.DB_QUERY_SUMMARY,
                f"bulk {index} operations={op_count}",
            )

    elif scope._db_operation == SemanticConvention.DB_OPERATION_GET:
        if endpoint == "elasticsearch.get":
            doc_id = scope._kwargs.get("id", "unknown")

            scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
            scope._span.set_attribute(
                SemanticConvention.DB_QUERY_SUMMARY,
                f"get {index} id={doc_id}",
            )

        elif endpoint == "elasticsearch.mget":
            body = scope._kwargs.get("body") or scope._kwargs.get("docs") or {}
            docs = body.get("docs", []) if isinstance(body, dict) else []

            scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
            scope._span.set_attribute(SemanticConvention.DB_VECTOR_COUNT, object_count(docs))
            scope._span.set_attribute(
                SemanticConvention.DB_QUERY_SUMMARY,
                f"mget {index} docs={object_count(docs)}",
            )

    elif scope._db_operation == SemanticConvention.DB_OPERATION_UPDATE:
        doc_id = scope._kwargs.get("id", "unknown")
        doc = scope._kwargs.get("doc") or scope._kwargs.get("body") or {}

        scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
        if capture_message_content:
            scope._span.set_attribute(SemanticConvention.DB_QUERY_TEXT, str(doc))
        scope._span.set_attribute(
            SemanticConvention.DB_QUERY_SUMMARY,
            f"update {index} id={doc_id}",
        )

    elif scope._db_operation == SemanticConvention.DB_OPERATION_DELETE:
        doc_id = scope._kwargs.get("id", "unknown")

        scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
        scope._span.set_attribute(
            SemanticConvention.DB_QUERY_SUMMARY,
            f"delete {index} id={doc_id}",
        )

    elif scope._db_operation in [
        SemanticConvention.DB_OPERATION_CREATE_INDEX,
        SemanticConvention.DB_OPERATION_DELETE_COLLECTION,
    ]:
        scope._span.set_attribute(SemanticConvention.DB_COLLECTION_NAME, str(index))
        scope._span.set_attribute(
            SemanticConvention.DB_QUERY_SUMMARY,
            f"{scope._db_operation} {index}",
        )

    scope._span.set_status(Status(StatusCode.OK))

    if not disable_metrics:
        record_db_metrics(
            metrics,
            SemanticConvention.DB_SYSTEM_ELASTICSEARCH,
            scope._server_address,
            scope._server_port,
            environment,
            application_name,
            scope._start_time,
            scope._end_time,
            scope._db_operation,
        )


def process_elasticsearch_response(
    response,
    db_operation,
    server_address,
    server_port,
    environment,
    application_name,
    metrics,
    start_time,
    span,
    capture_message_content,
    disable_metrics,
    version,
    endpoint=None,
    **kwargs,
):
    """Process Elasticsearch response and emit telemetry."""
    # pylint: disable=too-many-arguments, too-many-positional-arguments, too-many-locals
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._response = response
    scope._db_operation = db_operation
    scope._server_address = server_address
    scope._server_port = server_port
    scope._start_time = start_time
    scope._kwargs = kwargs

    common_elasticsearch_logic(
        scope,
        environment,
        application_name,
        metrics,
        capture_message_content,
        disable_metrics,
        version,
        endpoint=endpoint,
    )

    return response
