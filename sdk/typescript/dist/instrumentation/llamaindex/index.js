"use strict";
/**
 * OpenLIT LlamaIndex Instrumentation
 *
 * Monkey-patches LlamaIndex JS classes to emit OTel-compliant telemetry.
 * Mirrors the Python SDK: sdk/python/src/openlit/instrumentation/llamaindex/__init__.py
 *
 * Targets the `llamaindex` npm package (>=0.3.0).
 * Patches: LLM classes, query engines, chat engines, retrievers, embeddings,
 * index construction, document loaders, splitters, and synthesizers.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitLlamaIndexInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-llamaindex`, '1.0.0', config);
    }
    init() {
        const mainModule = new instrumentation_1.InstrumentationNodeModuleDefinition('llamaindex', ['>=0.3.0'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports)
                this._unpatch(moduleExports);
        });
        return [mainModule];
    }
    manualPatch(llamaindex) {
        this._patch(llamaindex);
    }
    // ---------------------------------------------------------------------------
    // Patch helpers
    // ---------------------------------------------------------------------------
    /**
     * Wrap an instance method on the first class found that exposes it.
     * Silently skips classes that aren't exported or don't have the method.
     */
    _patchProto(moduleExports, classNames, method, wrapper) {
        for (const name of classNames) {
            const Cls = moduleExports[name];
            if (Cls?.prototype?.[method] && !(0, instrumentation_1.isWrapped)(Cls.prototype[method])) {
                try {
                    this._wrap(Cls.prototype, method, wrapper);
                }
                catch { /* skip silently */ }
            }
        }
    }
    /**
     * Wrap a static method on a class.
     */
    _patchStatic(Cls, method, wrapper) {
        if (typeof Cls?.[method] === 'function' && !(0, instrumentation_1.isWrapped)(Cls[method])) {
            try {
                this._wrap(Cls, method, wrapper);
            }
            catch { /* skip silently */ }
        }
    }
    /**
     * Unwrap an instance method if it's wrapped.
     */
    _unwrapProto(moduleExports, classNames, method) {
        for (const name of classNames) {
            const Cls = moduleExports[name];
            if (Cls?.prototype?.[method] && (0, instrumentation_1.isWrapped)(Cls.prototype[method])) {
                try {
                    this._unwrap(Cls.prototype, method);
                }
                catch { /* ignore */ }
            }
        }
    }
    /**
     * Unwrap a static method if it's wrapped.
     */
    _unwrapStatic(Cls, method) {
        if (Cls && typeof Cls[method] === 'function' && (0, instrumentation_1.isWrapped)(Cls[method])) {
            try {
                this._unwrap(Cls, method);
            }
            catch { /* ignore */ }
        }
    }
    // ---------------------------------------------------------------------------
    // Main patch — mirrors Python _instrument() operation lists
    // ---------------------------------------------------------------------------
    _patch(m) {
        try {
            const tracer = this.tracer;
            // === LLM OPERATIONS (chat spans) ===
            // Mirrors Python: LLM.chat, LLM.complete
            const llmClasses = [
                'OpenAI', 'Anthropic', 'Ollama', 'Gemini', 'Groq',
                'HuggingFaceInference', 'Replicate', 'DeepSeek', 'Portkey',
                'BaseLLM', 'LLM',
            ];
            this._patchProto(m, llmClasses, 'chat', wrapper_1.default._patchLLMChat(tracer));
            this._patchProto(m, llmClasses, 'complete', wrapper_1.default._patchLLMComplete(tracer));
            // === QUERY ENGINE OPERATIONS (retrieval spans) ===
            // Mirrors Python: RetrieverQueryEngine.query, TransformQueryEngine.query
            const queryEngineClasses = [
                'RetrieverQueryEngine', 'TransformQueryEngine',
                'SubQuestionQueryEngine', 'BaseQueryEngine', 'QueryEngine',
            ];
            this._patchProto(m, queryEngineClasses, 'query', wrapper_1.default._patchQueryEngineQuery(tracer));
            // === CHAT ENGINE OPERATIONS (invoke_workflow spans) ===
            const chatEngineClasses = [
                'ContextChatEngine', 'SimpleChatEngine',
                'CondenseQuestionChatEngine', 'BaseChatEngine', 'ChatEngine',
            ];
            this._patchProto(m, chatEngineClasses, 'chat', wrapper_1.default._patchChatEngineChat(tracer));
            // === RETRIEVER OPERATIONS (retrieval spans) ===
            // Mirrors Python: VectorIndexRetriever.retrieve, BaseRetriever.retrieve
            const retrieverClasses = [
                'VectorIndexRetriever', 'BaseRetriever', 'Retriever',
            ];
            this._patchProto(m, retrieverClasses, 'retrieve', wrapper_1.default._patchRetrieverRetrieve(tracer));
            // === EMBEDDING OPERATIONS (embeddings spans) ===
            // Mirrors Python: BaseEmbedding.get_text_embedding_batch
            const embeddingClasses = [
                'OpenAIEmbedding', 'BaseEmbedding', 'HuggingFaceEmbedding',
            ];
            this._patchProto(m, embeddingClasses, 'getTextEmbedding', wrapper_1.default._patchEmbedding(tracer, 'embedding_generate'));
            this._patchProto(m, embeddingClasses, 'getQueryEmbedding', wrapper_1.default._patchEmbedding(tracer, 'embedding_generate'));
            this._patchProto(m, embeddingClasses, 'getTextEmbeddingsBatch', wrapper_1.default._patchEmbedding(tracer, 'embedding_generate'));
            // === INDEX OPERATIONS (invoke_workflow spans) ===
            // Mirrors Python: VectorStoreIndex.from_documents, from_vector_store
            const indexClasses = ['VectorStoreIndex', 'ListIndex', 'TreeIndex'];
            for (const name of indexClasses) {
                const Cls = m[name];
                if (Cls) {
                    this._patchStatic(Cls, 'fromDocuments', wrapper_1.default._patchFrameworkMethod(tracer, 'index_construct'));
                    this._patchStatic(Cls, 'fromVectorStore', wrapper_1.default._patchFrameworkMethod(tracer, 'index_construct'));
                }
            }
            // Mirrors Python: BaseIndex.as_query_engine, BaseIndex.as_retriever
            const indexProtoClasses = [
                'VectorStoreIndex', 'ListIndex', 'TreeIndex', 'BaseIndex',
            ];
            this._patchProto(m, indexProtoClasses, 'asQueryEngine', wrapper_1.default._patchFrameworkMethod(tracer, 'query_engine_create'));
            this._patchProto(m, indexProtoClasses, 'asRetriever', wrapper_1.default._patchFrameworkMethod(tracer, 'retriever_create'));
            // === DOCUMENT OPERATIONS (framework / retrieval spans) ===
            // Mirrors Python: SimpleDirectoryReader.load_data
            this._patchProto(m, ['SimpleDirectoryReader'], 'loadData', wrapper_1.default._patchFrameworkMethod(tracer, 'document_load'));
            // Mirrors Python: SentenceSplitter.get_nodes_from_documents
            this._patchProto(m, ['SentenceSplitter', 'NodeParser'], 'getNodesFromDocuments', wrapper_1.default._patchFrameworkMethod(tracer, 'document_split'));
            // Mirrors Python: SentenceSplitter.split_text
            this._patchProto(m, ['SentenceSplitter'], 'splitText', wrapper_1.default._patchFrameworkMethod(tracer, 'text_splitter_split'));
            // === SYNTHESIZER OPERATIONS (chat spans) ===
            // Mirrors Python: BaseSynthesizer.synthesize
            const synthesizerClasses = [
                'ResponseSynthesizer', 'CompactAndRefine', 'TreeSummarize',
                'BaseSynthesizer',
            ];
            this._patchProto(m, synthesizerClasses, 'synthesize', wrapper_1.default._patchFrameworkMethod(tracer, 'response_synthesize'));
            // === POSTPROCESSOR OPERATIONS (framework spans) ===
            this._patchProto(m, ['BaseNodePostprocessor', 'NodePostprocessor'], 'postprocessNodes', wrapper_1.default._patchFrameworkMethod(tracer, 'postprocessor_process'));
        }
        catch { /* graceful degradation — do not break the application */ }
    }
    // ---------------------------------------------------------------------------
    // Unpatch
    // ---------------------------------------------------------------------------
    _unpatch(m) {
        try {
            const llmClasses = [
                'OpenAI', 'Anthropic', 'Ollama', 'Gemini', 'Groq',
                'HuggingFaceInference', 'Replicate', 'DeepSeek', 'Portkey',
                'BaseLLM', 'LLM',
            ];
            this._unwrapProto(m, llmClasses, 'chat');
            this._unwrapProto(m, llmClasses, 'complete');
            const queryEngineClasses = [
                'RetrieverQueryEngine', 'TransformQueryEngine',
                'SubQuestionQueryEngine', 'BaseQueryEngine', 'QueryEngine',
            ];
            this._unwrapProto(m, queryEngineClasses, 'query');
            const chatEngineClasses = [
                'ContextChatEngine', 'SimpleChatEngine',
                'CondenseQuestionChatEngine', 'BaseChatEngine', 'ChatEngine',
            ];
            this._unwrapProto(m, chatEngineClasses, 'chat');
            const retrieverClasses = ['VectorIndexRetriever', 'BaseRetriever', 'Retriever'];
            this._unwrapProto(m, retrieverClasses, 'retrieve');
            const embeddingClasses = ['OpenAIEmbedding', 'BaseEmbedding', 'HuggingFaceEmbedding'];
            this._unwrapProto(m, embeddingClasses, 'getTextEmbedding');
            this._unwrapProto(m, embeddingClasses, 'getQueryEmbedding');
            this._unwrapProto(m, embeddingClasses, 'getTextEmbeddingsBatch');
            const indexClasses = ['VectorStoreIndex', 'ListIndex', 'TreeIndex'];
            for (const name of indexClasses) {
                const Cls = m[name];
                if (Cls) {
                    this._unwrapStatic(Cls, 'fromDocuments');
                    this._unwrapStatic(Cls, 'fromVectorStore');
                }
            }
            const indexProtoClasses = [
                'VectorStoreIndex', 'ListIndex', 'TreeIndex', 'BaseIndex',
            ];
            this._unwrapProto(m, indexProtoClasses, 'asQueryEngine');
            this._unwrapProto(m, indexProtoClasses, 'asRetriever');
            this._unwrapProto(m, ['SimpleDirectoryReader'], 'loadData');
            this._unwrapProto(m, ['SentenceSplitter', 'NodeParser'], 'getNodesFromDocuments');
            this._unwrapProto(m, ['SentenceSplitter'], 'splitText');
            const synthesizerClasses = [
                'ResponseSynthesizer', 'CompactAndRefine', 'TreeSummarize', 'BaseSynthesizer',
            ];
            this._unwrapProto(m, synthesizerClasses, 'synthesize');
            this._unwrapProto(m, ['BaseNodePostprocessor', 'NodePostprocessor'], 'postprocessNodes');
        }
        catch { /* ignore */ }
    }
}
exports.default = OpenlitLlamaIndexInstrumentation;
//# sourceMappingURL=index.js.map