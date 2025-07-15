"""
LlamaIndex OpenTelemetry instrumentation utility functions
Enhanced to work with LlamaIndex's built-in OTel support
"""
import time
from opentelemetry.trace import Status, StatusCode

from openlit.__helpers import (
    common_framework_span_attributes,
    record_framework_metrics,
)
from openlit.semcov import SemanticConvention

# Enhanced operation mapping following OpenTelemetry Gen AI Semantic Conventions
# Framework-agnostic operation names for reusability across AI frameworks
OPERATION_MAP = {
    # === WORKFLOW-LEVEL OPERATIONS (High-level workflow spans) ===
    
    # Document loading operations  
    "framework.document.load": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    "framework.document.load_async": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    
    # Data processing operations
    "framework.document.split": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.document.process": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Index construction operations (parent spans for indexing workflows)
    "framework.index.construct": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.index.build": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Query engine operations (parent spans for query workflows)
    "framework.query_engine.create": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.query_engine.query": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    
    # Retriever operations (child spans under query workflows)
    "framework.retriever.create": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.retriever.retrieve": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    
    # Embedding operations (child spans during indexing and retrieval)
    "framework.embedding.generate": SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
    
    # Vector store operations (child spans during indexing/querying)
    "framework.vector_store.add": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.vector_store.delete": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.vector_store.search": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    
    # LLM operations (child spans during query processing)
    "framework.llm.complete": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    "framework.llm.chat": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    
    # === COMPONENT-LEVEL OPERATIONS (Granular component task spans) ===
    
    # Text Splitter Components (granular text processing)
    "framework.text_splitter.split": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.text_splitter.postprocess": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Node Parser Components (granular node processing)
    "framework.node_parser.parse": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.node_parser.sentence_split": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.metadata_processor.extract": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Document Processing Components (individual document steps)
    "framework.document_processor.metadata": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.document_processor.process": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Embedding Components (granular embedding operations)
    "framework.embedding.encode": SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
    "framework.embedding.encode_nodes": SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
    "framework.embedding.similarity": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    
    # Retrieval Components (granular retrieval steps)
    "framework.retrieval.embed_query": SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
    "framework.retrieval.search": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    "framework.retrieval.postprocess": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.retrieval.filter": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Response Generation Components (granular response building)
    "framework.response.prepare_context": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.response.generate": SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
    "framework.response.format": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Vector Store Components (granular vector operations)
    "framework.vector_store.insert": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.vector_store.query": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    "framework.vector_store.update": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Memory and Caching Components (performance operations)
    "framework.cache.store": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.cache.retrieve": SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
    "framework.memory.update": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    
    # Index Maintenance Components (index management tasks)
    "framework.index.insert": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.index.delete": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.index.update": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
    "framework.index.refresh": SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
}

def object_count(obj):
    """
    Safely counts length of object if it exists and supports len(), else returns 0.
    """
    if not obj:
        return 0
    
    try:
        if hasattr(obj, '__len__'):
            return len(obj)
        elif hasattr(obj, 'count') and callable(obj.count):
            # For objects that have a count method
            return obj.count()
        else:
            # For single objects, return 1
            return 1
    except (TypeError, AttributeError):
        # Fallback for objects that don't support length operations
        return 1

def set_server_address_and_port(instance):
    """
    Extracts server address and port from LlamaIndex instance.
    
    Args:
        instance: LlamaIndex component instance
        
    Returns:
        tuple: (server_address, server_port)
    """
    server_address = "localhost"
    server_port = 8080
    
    # LlamaIndex components typically don't have server configurations
    # but we can extract from specific component types if needed
    if hasattr(instance, "config") and hasattr(instance.config, "host"):
        server_address = instance.config.host
        if hasattr(instance.config, "port"):
            server_port = instance.config.port
    
    # Check for LLM service configurations
    if hasattr(instance, "_llm") and hasattr(instance._llm, "api_base"):
        try:
            from urllib.parse import urlparse
            parsed = urlparse(instance._llm.api_base)
            server_address = parsed.hostname or "api.openai.com"
            server_port = parsed.port or (443 if parsed.scheme == "https" else 80)
        except:
            pass
    
    return server_address, server_port



def common_llamaindex_logic(scope, environment, application_name, 
    metrics, capture_message_content, disable_metrics, version, 
    instance=None, endpoint=None, **kwargs):
    """
    Process LlamaIndex framework request and generate telemetry.
    Enhanced to support both workflow-level and component-level operations for comprehensive observability.
    """
    scope._end_time = time.time()

    # Set common framework span attributes using centralized helper
    common_framework_span_attributes(scope, SemanticConvention.GEN_AI_SYSTEM_LLAMAINDEX,
        scope._server_address, scope._server_port, environment, application_name, 
        version, endpoint, instance)

    # Handle operation-specific attributes based on Gen AI conventions
    operation_type = OPERATION_MAP.get(endpoint, SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK)
    scope._span.set_attribute(SemanticConvention.GEN_AI_OPERATION, operation_type)

    # === WORKFLOW-LEVEL OPERATION PROCESSING ===
    
    if endpoint == "framework.index.construct":
        # Workflow-level index construction telemetry
        documents_count = scope._kwargs.get("documents", [])
        if documents_count:
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_DOCUMENTS_COUNT, object_count(documents_count))
            
        # Extract document sources for workflow insight
        document_sources = []
        if documents_count:
            for doc in documents_count[:5]:  # Limit to first 5 for performance
                source = getattr(doc, 'metadata', {}).get('file_path', 'unknown')
                document_sources.append(source)
        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_DOCUMENT_SOURCES, str(document_sources))

    elif endpoint == "framework.query_engine.query":
        # Workflow-level query processing telemetry
        query_text = scope._args[0] if scope._args else scope._kwargs.get("query", "unknown")
        if capture_message_content:
            scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, str(query_text))
        
        # Response handling for workflow insight  
        if scope._response:
            response_text = str(scope._response)
            if capture_message_content and len(response_text) > 0:
                scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_COMPLETION, response_text)
            
            # Extract retrieval metadata for workflow metrics
            if hasattr(scope._response, 'source_nodes'):
                retrieved_count = object_count(scope._response.source_nodes)
                scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_RETRIEVAL_COUNT, retrieved_count)
                
                # Extract source information
                if scope._response.source_nodes:
                    source = scope._response.source_nodes[0].metadata.get('file_path', 'unknown')
                    scope._span.set_attribute(SemanticConvention.GEN_AI_RETRIEVAL_SOURCE, source)

        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_QUERY_TYPE, "query_engine")

    elif endpoint == "framework.retriever.retrieve":
        # Workflow-level retrieval telemetry
        query_text = scope._args[0] if scope._args else scope._kwargs.get("query", "unknown")
        if capture_message_content:
            scope._span.set_attribute(SemanticConvention.GEN_AI_CONTENT_PROMPT, str(query_text))

        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_QUERY_TYPE, "retriever")

    elif endpoint == "framework.document.split":
        # Workflow-level data processing telemetry
        show_progress = scope._kwargs.get("show_progress", False)
        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_SHOW_PROGRESS, show_progress)
        
        # Extract node creation info for workflow metrics
        if scope._response and hasattr(scope._response, '__len__'):
            nodes_created = len(scope._response)
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_NODES_CREATED, nodes_created)
            
        # Extract chunk configuration for workflow insight
        chunk_size = getattr(instance, 'chunk_size', 1024) if instance else 1024
        chunk_overlap = getattr(instance, 'chunk_overlap', 200) if instance else 200
        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_CHUNK_SIZE, chunk_size)
        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_CHUNK_OVERLAP, chunk_overlap)

    # === COMPONENT-LEVEL OPERATION PROCESSING ===
    
    elif endpoint.startswith("framework.text_splitter"):
        # Component-level text splitting telemetry
        if endpoint == "framework.text_splitter.split":
            text_input = scope._args[0] if scope._args else scope._kwargs.get("text", "")
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_TEXT_LENGTH, len(str(text_input)))
            
            if scope._response and hasattr(scope._response, '__len__'):
                scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_CHUNK_COUNT, len(scope._response))
                
        elif endpoint == "framework.text_splitter.postprocess":
            nodes_input = scope._args[0] if scope._args else scope._kwargs.get("nodes", [])
            if hasattr(nodes_input, '__len__'):
                scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_NODES_PROCESSED, len(nodes_input))

    elif endpoint.startswith("framework.node_parser"):
        # Component-level node parsing telemetry
        if endpoint == "framework.node_parser.parse":
            if scope._args and hasattr(scope._args[0], 'text'):
                input_text = scope._args[0].text
                scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_TEXT_LENGTH, len(input_text))
                
        elif endpoint == "framework.node_parser.sentence_split":
            text_input = scope._args[0] if scope._args else ""
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_TEXT_LENGTH, len(str(text_input)))

    elif endpoint.startswith("framework.embedding"):
        # Component-level embedding task telemetry
        if endpoint == "framework.embedding.encode":
            texts = scope._args[0] if scope._args else scope._kwargs.get("texts", [])
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_EMBEDDING_COUNT, object_count(texts))
                
        elif endpoint == "framework.embedding.encode_nodes":
            nodes = scope._args[0] if scope._args else scope._kwargs.get("nodes", [])
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_NODES_COUNT, object_count(nodes))

    elif endpoint.startswith("framework.retrieval"):
        # Component-level retrieval step telemetry
        if endpoint == "framework.retrieval.embed_query":
            query_embedding = scope._args[0] if scope._args else scope._kwargs.get("query_embedding")
            if query_embedding:
                # Handle different types of query embeddings
                try:
                    if hasattr(query_embedding, '__len__'):
                        # Direct embedding vector
                        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_EMBEDDING_DIMENSION, len(query_embedding))
                    elif hasattr(query_embedding, 'query_str'):
                        # QueryBundle object - extract query string
                        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_QUERY_TEXT, str(query_embedding.query_str)[:200])
                    elif hasattr(query_embedding, 'embedding'):
                        # Object with embedding attribute
                        if hasattr(query_embedding.embedding, '__len__'):
                            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_EMBEDDING_DIMENSION, len(query_embedding.embedding))
                    else:
                        # Fallback - just record that an embedding was processed
                        scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_EMBEDDING_PROCESSED, True)
                except Exception:
                    # Safe fallback if any attribute access fails
                    scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_EMBEDDING_PROCESSED, True)
                
        elif endpoint == "framework.retrieval.postprocess":
            nodes = scope._args[0] if scope._args else scope._kwargs.get("nodes", [])
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_NODES_COUNT, object_count(nodes))

    elif endpoint.startswith("framework.response"):
        # Component-level response generation telemetry
        if endpoint == "framework.response.prepare_context":
            context_nodes = scope._kwargs.get("nodes", [])
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_CONTEXT_COUNT, object_count(context_nodes))
                
        elif endpoint == "framework.response.generate":
            prompt_template = scope._kwargs.get("template", "unknown")
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_TEMPLATE_TYPE, str(prompt_template)[:100])

    elif endpoint.startswith("framework.vector_store"):
        # Component-level vector store task telemetry using existing DB attributes
        if endpoint == "framework.vector_store.insert":
            nodes = scope._args[0] if scope._args else scope._kwargs.get("nodes", [])
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_NODES_ADDED, object_count(nodes))
                
        elif endpoint == "framework.vector_store.query":
            query_embedding = scope._args[0] if scope._args else scope._kwargs.get("query_embedding")
            similarity_top_k = scope._kwargs.get("similarity_top_k", 2)
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_SIMILARITY_TOP_K, similarity_top_k)

    elif endpoint.startswith("framework.index"):
        # Component-level index maintenance telemetry
        if endpoint == "framework.index.insert":
            nodes = scope._args[0] if scope._args else scope._kwargs.get("nodes", [])
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_NODES_INSERTED, object_count(nodes))
                
        elif endpoint == "framework.index.delete":
            node_id = scope._args[0] if scope._args else scope._kwargs.get("node_id", "unknown")
            scope._span.set_attribute(SemanticConvention.GEN_AI_FRAMEWORK_NODE_ID, str(node_id))

    # Set general operation duration for all operations
    scope._span.set_attribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, 
        scope._end_time - scope._start_time)

    scope._span.set_status(Status(StatusCode.OK))

    # Record metrics using helper for framework operations (only gen_ai_requests counter)
    if not disable_metrics:
        record_framework_metrics(metrics, scope._operation_type, SemanticConvention.GEN_AI_SYSTEM_LLAMAINDEX, 
            scope._server_address, scope._server_port, environment, application_name, 
            scope._start_time, scope._end_time)

def process_llamaindex_response(response, operation_type, server_address, server_port,
    environment, application_name, metrics, start_time, span,
    capture_message_content, disable_metrics, version, instance=None, 
    args=None, endpoint=None, **kwargs):
    """
    Process LlamaIndex framework response and generate telemetry.
    Enhanced with Gen AI semantic conventions support.
    """
    # Create scope object to hold telemetry data
    scope = type("GenericScope", (), {})()
    scope._span = span
    scope._operation_type = operation_type
    scope._response = response
    scope._start_time = start_time
    scope._server_address = server_address
    scope._server_port = server_port
    scope._args = args
    scope._kwargs = kwargs
    
    # Process response and generate telemetry
    common_llamaindex_logic(
        scope, environment, application_name, metrics, 
        capture_message_content, disable_metrics, version,
        instance, endpoint
    )
    
    return response 