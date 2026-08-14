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

import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import type { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import LlamaIndexWrapper from './wrapper';

export default class OpenlitLlamaIndexInstrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-llamaindex`, '1.0.0', config);
  }

  protected init():
    | void
    | InstrumentationModuleDefinition
    | InstrumentationModuleDefinition[] {
    const mainModule = new InstrumentationNodeModuleDefinition(
      'llamaindex',
      ['>=0.3.0'],
      (moduleExports) => {
        this._patch(moduleExports);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports) this._unpatch(moduleExports);
      },
    );

    return [mainModule];
  }

  public manualPatch(llamaindex: any): void {
    this._patch(llamaindex);
  }

  // ---------------------------------------------------------------------------
  // Patch helpers
  // ---------------------------------------------------------------------------

  /**
   * Wrap an instance method on the first class found that exposes it.
   * Silently skips classes that aren't exported or don't have the method.
   */
  private _patchProto(
    moduleExports: any,
    classNames: string[],
    method: string,
    wrapper: any,
  ): void {
    for (const name of classNames) {
      const Cls = moduleExports[name];
      if (Cls?.prototype?.[method] && !isWrapped(Cls.prototype[method])) {
        try {
          this._wrap(Cls.prototype, method, wrapper);
        } catch { /* skip silently */ }
      }
    }
  }

  /**
   * Wrap a static method on a class.
   */
  private _patchStatic(
    Cls: any,
    method: string,
    wrapper: any,
  ): void {
    if (typeof Cls?.[method] === 'function' && !isWrapped(Cls[method])) {
      try {
        this._wrap(Cls, method, wrapper);
      } catch { /* skip silently */ }
    }
  }

  /**
   * Unwrap an instance method if it's wrapped.
   */
  private _unwrapProto(
    moduleExports: any,
    classNames: string[],
    method: string,
  ): void {
    for (const name of classNames) {
      const Cls = moduleExports[name];
      if (Cls?.prototype?.[method] && isWrapped(Cls.prototype[method])) {
        try {
          this._unwrap(Cls.prototype, method);
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Unwrap a static method if it's wrapped.
   */
  private _unwrapStatic(Cls: any, method: string): void {
    if (Cls && typeof Cls[method] === 'function' && isWrapped(Cls[method])) {
      try {
        this._unwrap(Cls, method);
      } catch { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Main patch — mirrors Python _instrument() operation lists
  // ---------------------------------------------------------------------------

  protected _patch(m: any): void {
    try {
      const tracer = this.tracer;

      // === LLM OPERATIONS (chat spans) ===
      // Mirrors Python: LLM.chat, LLM.complete
      const llmClasses = [
        'OpenAI', 'Anthropic', 'Ollama', 'Gemini', 'Groq',
        'HuggingFaceInference', 'Replicate', 'DeepSeek', 'Portkey',
        'BaseLLM', 'LLM',
      ];
      this._patchProto(m, llmClasses, 'chat',
        LlamaIndexWrapper._patchLLMChat(tracer));
      this._patchProto(m, llmClasses, 'complete',
        LlamaIndexWrapper._patchLLMComplete(tracer));

      // === QUERY ENGINE OPERATIONS (retrieval spans) ===
      // Mirrors Python: RetrieverQueryEngine.query, TransformQueryEngine.query
      const queryEngineClasses = [
        'RetrieverQueryEngine', 'TransformQueryEngine',
        'SubQuestionQueryEngine', 'BaseQueryEngine', 'QueryEngine',
      ];
      this._patchProto(m, queryEngineClasses, 'query',
        LlamaIndexWrapper._patchQueryEngineQuery(tracer));

      // === CHAT ENGINE OPERATIONS (invoke_workflow spans) ===
      const chatEngineClasses = [
        'ContextChatEngine', 'SimpleChatEngine',
        'CondenseQuestionChatEngine', 'BaseChatEngine', 'ChatEngine',
      ];
      this._patchProto(m, chatEngineClasses, 'chat',
        LlamaIndexWrapper._patchChatEngineChat(tracer));

      // === RETRIEVER OPERATIONS (retrieval spans) ===
      // Mirrors Python: VectorIndexRetriever.retrieve, BaseRetriever.retrieve
      const retrieverClasses = [
        'VectorIndexRetriever', 'BaseRetriever', 'Retriever',
      ];
      this._patchProto(m, retrieverClasses, 'retrieve',
        LlamaIndexWrapper._patchRetrieverRetrieve(tracer));

      // === EMBEDDING OPERATIONS (embeddings spans) ===
      // Mirrors Python: BaseEmbedding.get_text_embedding_batch
      const embeddingClasses = [
        'OpenAIEmbedding', 'BaseEmbedding', 'HuggingFaceEmbedding',
      ];
      this._patchProto(m, embeddingClasses, 'getTextEmbedding',
        LlamaIndexWrapper._patchEmbedding(tracer, 'embedding_generate'));
      this._patchProto(m, embeddingClasses, 'getQueryEmbedding',
        LlamaIndexWrapper._patchEmbedding(tracer, 'embedding_generate'));
      this._patchProto(m, embeddingClasses, 'getTextEmbeddingsBatch',
        LlamaIndexWrapper._patchEmbedding(tracer, 'embedding_generate'));

      // === INDEX OPERATIONS (invoke_workflow spans) ===
      // Mirrors Python: VectorStoreIndex.from_documents, from_vector_store
      const indexClasses = ['VectorStoreIndex', 'ListIndex', 'TreeIndex'];
      for (const name of indexClasses) {
        const Cls = m[name];
        if (Cls) {
          this._patchStatic(Cls, 'fromDocuments',
            LlamaIndexWrapper._patchFrameworkMethod(tracer, 'index_construct'));
          this._patchStatic(Cls, 'fromVectorStore',
            LlamaIndexWrapper._patchFrameworkMethod(tracer, 'index_construct'));
        }
      }

      // Mirrors Python: BaseIndex.as_query_engine, BaseIndex.as_retriever
      const indexProtoClasses = [
        'VectorStoreIndex', 'ListIndex', 'TreeIndex', 'BaseIndex',
      ];
      this._patchProto(m, indexProtoClasses, 'asQueryEngine',
        LlamaIndexWrapper._patchFrameworkMethod(tracer, 'query_engine_create'));
      this._patchProto(m, indexProtoClasses, 'asRetriever',
        LlamaIndexWrapper._patchFrameworkMethod(tracer, 'retriever_create'));

      // === DOCUMENT OPERATIONS (framework / retrieval spans) ===
      // Mirrors Python: SimpleDirectoryReader.load_data
      this._patchProto(m, ['SimpleDirectoryReader'], 'loadData',
        LlamaIndexWrapper._patchFrameworkMethod(tracer, 'document_load'));

      // Mirrors Python: SentenceSplitter.get_nodes_from_documents
      this._patchProto(m, ['SentenceSplitter', 'NodeParser'], 'getNodesFromDocuments',
        LlamaIndexWrapper._patchFrameworkMethod(tracer, 'document_split'));

      // Mirrors Python: SentenceSplitter.split_text
      this._patchProto(m, ['SentenceSplitter'], 'splitText',
        LlamaIndexWrapper._patchFrameworkMethod(tracer, 'text_splitter_split'));

      // === SYNTHESIZER OPERATIONS (chat spans) ===
      // Mirrors Python: BaseSynthesizer.synthesize
      const synthesizerClasses = [
        'ResponseSynthesizer', 'CompactAndRefine', 'TreeSummarize',
        'BaseSynthesizer',
      ];
      this._patchProto(m, synthesizerClasses, 'synthesize',
        LlamaIndexWrapper._patchFrameworkMethod(tracer, 'response_synthesize'));

      // === POSTPROCESSOR OPERATIONS (framework spans) ===
      this._patchProto(m, ['BaseNodePostprocessor', 'NodePostprocessor'], 'postprocessNodes',
        LlamaIndexWrapper._patchFrameworkMethod(tracer, 'postprocessor_process'));

    } catch { /* graceful degradation — do not break the application */ }
  }

  // ---------------------------------------------------------------------------
  // Unpatch
  // ---------------------------------------------------------------------------

  protected _unpatch(m: any): void {
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
    } catch { /* ignore */ }
  }
}
