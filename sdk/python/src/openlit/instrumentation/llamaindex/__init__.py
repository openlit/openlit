"""
OpenLIT LlamaIndex Instrumentation
"""

from typing import Collection
import importlib.metadata
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from wrapt import wrap_function_wrapper

from openlit.instrumentation.llamaindex.llamaindex import general_wrap
from openlit.instrumentation.llamaindex.async_llamaindex import async_general_wrap

_instruments = ("llama-index >= 0.10.0",)

# Comprehensive operations to wrap for LlamaIndex framework - Business + Developer level observability
LLAMAINDEX_OPERATIONS = [
    # === BUSINESS LEVEL OPERATIONS (Workflow-level spans) ===
    
    # Document loading operations
    ("load_data", "llamaindex.load_data"),
    ("aload_data", "llamaindex.aload_data"),
    
    # Document processing operations
    ("get_nodes_from_documents", "llamaindex.data_splitter"),
    
    # Index construction operations (creates parent spans for indexing workflows)
    ("from_documents", "llamaindex.index_construction"),
    ("from_vector_store", "llamaindex.index_construction"),
    ("build_index_from_nodes", "llamaindex.index_construction"),
    
    # Query engine operations (creates parent spans for query workflows)
    ("as_query_engine", "llamaindex.query_engine_creation"),
    ("query", "llamaindex.query_engine"),
    ("aquery", "llamaindex.query_engine"),
    
    # Retriever operations (child spans under query workflows)
    ("as_retriever", "llamaindex.retriever_creation"),
    ("retrieve", "llamaindex.retriever"),
    ("aretrieve", "llamaindex.retriever"),
    
    # Embedding operations (child spans during indexing and retrieval)
    ("get_text_embedding", "llamaindex.embedding"),
    ("aget_text_embedding", "llamaindex.embedding"),
    ("get_text_embedding_batch", "llamaindex.embedding"),
    ("aget_text_embedding_batch", "llamaindex.embedding"),
    
    # Vector store operations (child spans during indexing/querying)
    ("add", "llamaindex.vector_store_add"),
    ("delete", "llamaindex.vector_store_delete"),
    ("query", "llamaindex.vector_search"),
    
    # LLM operations (child spans during query processing)
    ("complete", "llamaindex.llm_completion"),
    ("acomplete", "llamaindex.llm_completion"),
    ("chat", "llamaindex.llm_chat"),
    ("achat", "llamaindex.llm_chat"),
    ("stream_complete", "llamaindex.llm_completion"),
    ("astream_complete", "llamaindex.llm_completion"),
    ("stream_chat", "llamaindex.llm_chat"),
    ("astream_chat", "llamaindex.llm_chat"),
    
    # === DEVELOPER LEVEL OPERATIONS (Component-level task spans) ===
    
    # Text Splitter Components (granular text processing)
    ("split_text", "llamaindex.text_splitter.task"),
    ("split_texts", "llamaindex.text_splitter.task"),
    ("_postprocess_nodes", "llamaindex.text_splitter.postprocess"),
    
    # Node Parser Components (granular node processing)
    ("get_nodes_from_node", "llamaindex.node_parser.task"),
    ("_parse_nodes", "llamaindex.node_parser.task"),
    ("_filter_metadata", "llamaindex.metadata_processor.task"),
    
    # Document Processing Components (individual document steps)
    ("_extract_metadata", "llamaindex.document_processor.metadata"),
    ("_process_document", "llamaindex.document_processor.task"),
    
    # Embedding Components (granular embedding operations)
    ("_get_text_embeddings", "llamaindex.embedding.task"),
    ("_embed_nodes", "llamaindex.embedding.node_task"),
    ("_similarity_query", "llamaindex.embedding.similarity"),
    
    # Retrieval Components (granular retrieval steps)
    ("_get_nodes_with_embeddings", "llamaindex.retrieval.embedding_task"),
    ("_retrieve_nodes", "llamaindex.retrieval.task"),
    ("_postprocess_nodes", "llamaindex.retrieval.postprocess"),
    ("_apply_node_filters", "llamaindex.retrieval.filter"),
    
    # Response Generation Components (granular response building)
    ("_prepare_context", "llamaindex.response.context_prep"),
    ("_generate_response", "llamaindex.response.generation"),
    ("_format_response", "llamaindex.response.formatting"),
    
    # Vector Store Components (granular vector operations)
    ("_add_nodes", "llamaindex.vector_store.add_task"),
    ("_query_nodes", "llamaindex.vector_store.query_task"),
    ("_update_embeddings", "llamaindex.vector_store.update_task"),
    
    # Memory and Caching Components (performance operations)
    ("_store_in_cache", "llamaindex.cache.store"),
    ("_retrieve_from_cache", "llamaindex.cache.retrieve"),
    ("_update_memory", "llamaindex.memory.update"),
    
    # Index Maintenance Components (index management tasks)
    ("_insert_nodes", "llamaindex.index.insert_task"),
    ("_delete_nodes", "llamaindex.index.delete_task"),
    ("_update_index", "llamaindex.index.update_task"),
    ("_refresh_index", "llamaindex.index.refresh_task"),
]

class LlamaIndexInstrumentor(BaseInstrumentor):
    """
    An instrumentor for LlamaIndex's client library with comprehensive operation coverage.
    """

    def instrumentation_dependencies(self) -> Collection[str]:
        return _instruments

    def _instrument(self, **kwargs):
        version = importlib.metadata.version("llama-index")
        environment = kwargs.get("environment", "default")
        application_name = kwargs.get("application_name", "default")
        tracer = kwargs.get("tracer")
        pricing_info = kwargs.get("pricing_info", {})
        capture_message_content = kwargs.get("capture_message_content", False)
        metrics = kwargs.get("metrics_dict")
        disable_metrics = kwargs.get("disable_metrics")
        detailed_tracing = kwargs.get("detailed_tracing", False)

        # === WORKFLOW-LEVEL INSTRUMENTATION (Always enabled for production monitoring) ===

        # Document loading operations
        try:
            wrap_function_wrapper(
                "llama_index.core.readers",
                "SimpleDirectoryReader.load_data",
                general_wrap(
                    "framework.document.load", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.readers",
                "SimpleDirectoryReader.aload_data",
                async_general_wrap(
                    "framework.document.load_async", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        # Document processing operations  
        try:
            wrap_function_wrapper(
                "llama_index.core.node_parser",
                "SentenceSplitter.get_nodes_from_documents",
                general_wrap(
                    "framework.document.split", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        # Index construction operations (create parent spans for indexing workflows)
        try:
            wrap_function_wrapper(
                "llama_index.core.indices.vector_store.base",
                "VectorStoreIndex.from_documents",
                general_wrap(
                    "framework.index.construct", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.indices.vector_store.base",
                "VectorStoreIndex.from_vector_store",
                general_wrap(
                    "framework.index.construct", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        # Query engine operations (create parent spans for query workflows)
        try:
            wrap_function_wrapper(
                "llama_index.core.indices.base",
                "BaseIndex.as_query_engine",
                general_wrap(
                    "framework.query_engine.create", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.query_engine.retriever_query_engine",
                "RetrieverQueryEngine.query",
                general_wrap(
                    "framework.query_engine.query", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.query_engine.retriever_query_engine",
                "RetrieverQueryEngine.aquery",
                async_general_wrap(
                    "framework.query_engine.query", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        # Retriever operations (child spans under query workflows)
        try:
            wrap_function_wrapper(
                "llama_index.core.indices.base",
                "BaseIndex.as_retriever",
                general_wrap(
                    "framework.retriever.create", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.indices.vector_store.retrievers.retriever",
                "VectorIndexRetriever.retrieve",
                general_wrap(
                    "framework.retriever.retrieve", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.indices.vector_store.retrievers.retriever",
                "VectorIndexRetriever.aretrieve",
                async_general_wrap(
                    "framework.retriever.retrieve", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        # Embedding operations (child spans during indexing and retrieval)
        try:
            wrap_function_wrapper(
                "llama_index.core.embeddings.base",
                "BaseEmbedding.get_text_embedding",
                general_wrap(
                    "framework.embedding.generate", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.embeddings.base",
                "BaseEmbedding.aget_text_embedding",
                async_general_wrap(
                    "framework.embedding.generate", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.embeddings.base",
                "BaseEmbedding.get_text_embedding_batch",
                general_wrap(
                    "framework.embedding.generate", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.embeddings.base",
                "BaseEmbedding.aget_text_embedding_batch",
                async_general_wrap(
                    "framework.embedding.generate", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        # Vector store operations (child spans during indexing/querying)
        try:
            wrap_function_wrapper(
                "llama_index.core.vector_stores.simple",
                "SimpleVectorStore.add",
                general_wrap(
                    "framework.vector_store.add", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.vector_stores.simple",
                "SimpleVectorStore.delete",
                general_wrap(
                    "framework.vector_store.delete", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.vector_stores.simple",
                "SimpleVectorStore.query",
                general_wrap(
                    "framework.vector_store.search", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        # LLM operations (child spans during query processing)
        try:
            wrap_function_wrapper(
                "llama_index.core.llms.llm",
                "LLM.complete",
                general_wrap(
                    "framework.llm.complete", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.llms.llm",
                "LLM.acomplete",
                async_general_wrap(
                    "framework.llm.complete", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.llms.llm",
                "LLM.chat",
                general_wrap(
                    "framework.llm.chat", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        try:
            wrap_function_wrapper(
                "llama_index.core.llms.llm",
                "LLM.achat",
                async_general_wrap(
                    "framework.llm.chat", version, environment, application_name, tracer,
                    pricing_info, capture_message_content, metrics, disable_metrics
                ),
            )
        except Exception:
            pass  # Module may not exist in all LlamaIndex versions

        # === COMPONENT-LEVEL INSTRUMENTATION (Only enabled when detailed_tracing=True) ===
        if detailed_tracing:
            # Text Splitter Components - provides granular text processing observability
            try:
                wrap_function_wrapper(
                    "llama_index.core.node_parser.text.sentence",
                    "SentenceSplitter.split_text",
                    general_wrap(
                        "llamaindex.text_splitter.task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
                
                wrap_function_wrapper(
                    "llama_index.core.node_parser.text.sentence",
                    "SentenceSplitter._postprocess_nodes",
                    general_wrap(
                        "llamaindex.text_splitter.postprocess", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass  # Some modules may not exist in all LlamaIndex versions

            # Node Parser Components - provides granular node processing observability
            try:
                wrap_function_wrapper(
                    "llama_index.core.node_parser.interface",
                    "NodeParser.get_nodes_from_node",
                    general_wrap(
                        "llamaindex.node_parser.task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
                
                wrap_function_wrapper(
                    "llama_index.core.node_parser.text.utils",
                    "split_by_sentence_tokenizer",
                    general_wrap(
                        "llamaindex.node_parser.sentence_split", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass

            # Document Processing Components - provides document-level task observability
            try:
                wrap_function_wrapper(
                    "llama_index.core.readers.base",
                    "BaseReader._extract_metadata",
                    general_wrap(
                        "llamaindex.document_processor.metadata", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass

            # Embedding Components - provides granular embedding task observability
            try:
                wrap_function_wrapper(
                    "llama_index.core.embeddings.base",
                    "BaseEmbedding._get_text_embeddings",
                    general_wrap(
                        "llamaindex.embedding.task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
            )

                wrap_function_wrapper(
                    "llama_index.core.embeddings.utils",
                    "embed_nodes",
                    general_wrap(
                        "llamaindex.embedding.node_task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass

            # Retrieval Components - provides granular retrieval step observability
            try:
                wrap_function_wrapper(
                    "llama_index.core.indices.vector_store.retrievers.retriever",
                    "VectorIndexRetriever._get_nodes_with_embeddings",
                    general_wrap(
                        "llamaindex.retrieval.embedding_task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
                
                wrap_function_wrapper(
                    "llama_index.core.postprocessor.node",
                    "BaseNodePostprocessor.postprocess_nodes",
                    general_wrap(
                        "llamaindex.retrieval.postprocess", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass

            # Response Generation Components - provides granular response building observability  
            try:
                wrap_function_wrapper(
                    "llama_index.core.query_engine.retriever_query_engine",
                    "RetrieverQueryEngine._prepare_response_builder",
                    general_wrap(
                        "llamaindex.response.context_prep", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
                
                wrap_function_wrapper(
                    "llama_index.core.response_synthesizers.base",
                    "BaseSynthesizer.synthesize",
                    general_wrap(
                        "llamaindex.response.generation", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass

            # Vector Store Components - provides granular vector operation observability
            try:
                wrap_function_wrapper(
                    "llama_index.core.vector_stores.simple",
                    "SimpleVectorStore._add_nodes",
                    general_wrap(
                        "llamaindex.vector_store.add_task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
                
                wrap_function_wrapper(
                    "llama_index.core.vector_stores.simple",
                    "SimpleVectorStore._query_nodes",
                    general_wrap(
                        "llamaindex.vector_store.query_task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass

            # Index Maintenance Components - provides index management task observability
            try:
                wrap_function_wrapper(
                    "llama_index.core.indices.vector_store.base",
                    "VectorStoreIndex._insert",
                    general_wrap(
                        "llamaindex.index.insert_task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
                
                wrap_function_wrapper(
                    "llama_index.core.indices.vector_store.base",
                    "VectorStoreIndex._delete_node",
                    general_wrap(
                        "llamaindex.index.delete_task", version, environment, application_name, tracer,
                        pricing_info, capture_message_content, metrics, disable_metrics
                    ),
                )
            except Exception:
                pass

    def _uninstrument(self, **kwargs):
        pass
