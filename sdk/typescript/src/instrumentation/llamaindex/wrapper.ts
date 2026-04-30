/**
 * OpenLIT LlamaIndex Wrapper
 *
 * Mirrors Python SDK: sdk/python/src/openlit/instrumentation/llamaindex/
 * Uses the same OPERATION_MAP and span semantics as the Python implementation.
 *
 * LLM operations get full provider-style telemetry (attributes, events, metrics).
 * Framework operations (query engine, retriever, index, etc.) get framework-level spans.
 */

import { Tracer, SpanKind, context, trace, Span } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper, { runWithFrameworkLlm } from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

/**
 * Operation mapping matching Python SDK's OPERATION_MAP in
 * sdk/python/src/openlit/instrumentation/llamaindex/utils.py
 */
const OPERATION_MAP: Record<string, string> = {
  // Document Loading & Processing
  document_load: SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,
  document_transform: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  document_split: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,

  // Index Construction & Management
  index_construct: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  index_insert: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  index_delete: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  index_build: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,

  // Query Engine Operations
  query_engine_create: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  query_engine_query: SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,

  // Retriever Operations
  retriever_create: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  retriever_retrieve: SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,

  // LLM Operations
  llm_chat: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
  llm_complete: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,

  // Embedding Operations
  embedding_generate: SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,

  // Response Synthesis
  response_synthesize: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,

  // Text Processing Components
  text_splitter_split: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  node_parser_parse: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,

  // Vector Store Components
  vector_store_add: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  vector_store_delete: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
  vector_store_query: SemanticConvention.GEN_AI_OPERATION_TYPE_RETRIEVE,

  // Postprocessor
  postprocessor_process: SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK,
};

export default class LlamaIndexWrapper {
  static aiSystem = SemanticConvention.GEN_AI_SYSTEM_LLAMAINDEX;

  // ---------------------------------------------------------------------------
  // Helpers (mirrors Python set_server_address_and_port / model extraction)
  // ---------------------------------------------------------------------------

  private static _extractModel(instance: any): string {
    return instance?.model
      || instance?.modelName
      || instance?.metadata?.model
      || instance?.llm?.model
      || instance?._llm?.model
      || instance?._responseSynthesizer?.llm?.model
      || instance?._responseSynthesizer?._llm?.model
      || 'unknown';
  }

  private static _extractServerInfo(instance: any): { address: string; port: number } {
    const candidates = [
      instance?._client?.baseURL,
      instance?.session?.openai?.baseURL,
      instance?.clientOptions?.baseURL,
      instance?.llm?._client?.baseURL,
      instance?._llm?._client?.baseURL,
      instance?.llm?.session?.openai?.baseURL,
      instance?._llm?.session?.openai?.baseURL,
    ];
    for (const rawUrl of candidates) {
      if (rawUrl) {
        try {
          const parsed = new URL(rawUrl);
          return {
            address: parsed.hostname,
            port: parsed.port
              ? parseInt(parsed.port, 10)
              : (parsed.protocol === 'https:' ? 443 : 80),
          };
        } catch { /* try next */ }
      }
    }
    return { address: 'localhost', port: 8000 };
  }

  // ---------------------------------------------------------------------------
  // LLM chat patch — full provider-style telemetry + frameworkLlmActive
  // Mirrors Python: LLM.chat -> operation_type "chat"
  // ---------------------------------------------------------------------------

  static _patchLLMChat(tracer: Tracer): any {
    const endpoint = 'llm_chat';
    const operationType = OPERATION_MAP[endpoint];

    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        const requestModel = LlamaIndexWrapper._extractModel(this);
        const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
        const spanName = `${operationType} ${requestModel}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationType,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
            [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
            [SemanticConvention.SERVER_ADDRESS]: address,
            [SemanticConvention.SERVER_PORT]: port,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();

          const onSuccess = (response: any) => {
            try {
              LlamaIndexWrapper._processLLMResponse(
                span, response, requestModel, address, port, startTime, args, 'chat',
              );
            } catch { /* swallow telemetry errors */ }
            return response;
          };

          const onError = (e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint: endpoint,
              model: requestModel,
              aiSystem: LlamaIndexWrapper.aiSystem,
              serverAddress: address,
              serverPort: port,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          };

          try {
            const result = runWithFrameworkLlm(() => originalMethod.apply(this, args));
            if (result && typeof (result as any).then === 'function') {
              return (result as Promise<any>).then(onSuccess).catch(onError);
            }
            return onSuccess(result);
          } catch (e: any) {
            return onError(e);
          }
        });
      };
    };
  }

  // ---------------------------------------------------------------------------
  // LLM complete patch — full provider-style telemetry + frameworkLlmActive
  // Mirrors Python: LLM.complete -> operation_type "chat"
  // ---------------------------------------------------------------------------

  static _patchLLMComplete(tracer: Tracer): any {
    const endpoint = 'llm_complete';
    const operationType = OPERATION_MAP[endpoint];

    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        const requestModel = LlamaIndexWrapper._extractModel(this);
        const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
        const spanName = `${operationType} ${requestModel}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationType,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
            [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
            [SemanticConvention.SERVER_ADDRESS]: address,
            [SemanticConvention.SERVER_PORT]: port,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();

          const onSuccess = (response: any) => {
            try {
              LlamaIndexWrapper._processLLMResponse(
                span, response, requestModel, address, port, startTime, args, 'complete',
              );
            } catch { /* swallow */ }
            return response;
          };

          const onError = (e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint: endpoint,
              model: requestModel,
              aiSystem: LlamaIndexWrapper.aiSystem,
              serverAddress: address,
              serverPort: port,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          };

          try {
            const result = runWithFrameworkLlm(() => originalMethod.apply(this, args));
            if (result && typeof (result as any).then === 'function') {
              return (result as Promise<any>).then(onSuccess).catch(onError);
            }
            return onSuccess(result);
          } catch (e: any) {
            return onError(e);
          }
        });
      };
    };
  }

  // ---------------------------------------------------------------------------
  // Shared LLM response processor — attributes, events, metrics
  // ---------------------------------------------------------------------------

  private static _processLLMResponse(
    span: Span,
    response: any,
    requestModel: string,
    serverAddress: string,
    serverPort: number,
    startTime: number,
    args: any[],
    mode: 'chat' | 'complete',
  ): void {
    const endpoint = mode === 'chat' ? 'llm_chat' : 'llm_complete';
    const duration = (Date.now() - startTime) / 1000;

    const rawUsage = response?.raw?.usage || response?.usage || {};
    const inputTokens = rawUsage.prompt_tokens || rawUsage.input_tokens || 0;
    const outputTokens = rawUsage.completion_tokens || rawUsage.output_tokens || 0;
    const finishReason = response?.raw?.choices?.[0]?.finish_reason || 'stop';
    const responseModel = response?.raw?.model || requestModel;
    const responseId = response?.raw?.id || '';

    const pricingInfo = OpenlitConfig.pricingInfo || {};
    const cost = OpenLitHelper.getChatModelCost(
      requestModel, pricingInfo, inputTokens, outputTokens,
    );

    BaseWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint: endpoint,
      model: requestModel,
      cost,
      aiSystem: LlamaIndexWrapper.aiSystem,
      serverAddress,
      serverPort,
    });

    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);
    if (responseModel) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);
    }
    if (responseId) {
      span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, responseId);
    }
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, [finishReason]);
    if (inputTokens) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, inputTokens);
    }
    if (outputTokens) {
      span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, outputTokens);
    }
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration);

    let inputMessagesJson = '';
    let outputMessagesJson = '';

    if (OpenlitConfig.captureMessageContent) {
      if (mode === 'chat') {
        const messages = args[0]?.messages || (Array.isArray(args[0]) ? args[0] : []);
        const formatted = (Array.isArray(messages) ? messages : [messages]).map((m: any) => ({
          role: m.role || 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
        }));
        inputMessagesJson = OpenLitHelper.buildInputMessages(formatted);
        const text = response?.message?.content || response?.text || '';
        outputMessagesJson = OpenLitHelper.buildOutputMessages(text, finishReason);
      } else {
        const prompt = typeof args[0] === 'string' ? args[0] : args[0]?.prompt || '';
        inputMessagesJson = OpenLitHelper.buildInputMessages([{ role: 'user', content: prompt }]);
        const text = response?.text || '';
        outputMessagesJson = OpenLitHelper.buildOutputMessages(text, finishReason);
      }
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, inputMessagesJson);
      span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_MESSAGES, outputMessagesJson);
    }

    const eventAttrs: Record<string, any> = {
      [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
      [SemanticConvention.GEN_AI_REQUEST_MODEL]: requestModel,
      [SemanticConvention.GEN_AI_RESPONSE_MODEL]: responseModel,
      [SemanticConvention.SERVER_ADDRESS]: serverAddress,
      [SemanticConvention.SERVER_PORT]: serverPort,
      [SemanticConvention.GEN_AI_RESPONSE_ID]: responseId,
      [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: [finishReason],
      [SemanticConvention.GEN_AI_OUTPUT_TYPE]: SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT,
      [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: inputTokens,
      [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: outputTokens,
    };
    if (OpenlitConfig.captureMessageContent) {
      eventAttrs[SemanticConvention.GEN_AI_INPUT_MESSAGES] = inputMessagesJson;
      eventAttrs[SemanticConvention.GEN_AI_OUTPUT_MESSAGES] = outputMessagesJson;
    }
    OpenLitHelper.emitInferenceEvent(span, eventAttrs);

    BaseWrapper.recordMetrics(span, {
      genAIEndpoint: endpoint,
      model: requestModel,
      cost,
      aiSystem: LlamaIndexWrapper.aiSystem,
      serverAddress,
      serverPort,
    });

    span.end();
  }

  // ---------------------------------------------------------------------------
  // Query engine query patch — retrieval span with source nodes
  // Mirrors Python: RetrieverQueryEngine.query -> operation_type "retrieval"
  // ---------------------------------------------------------------------------

  static _patchQueryEngineQuery(tracer: Tracer): any {
    const endpoint = 'query_engine_query';
    const operationType = OPERATION_MAP[endpoint];

    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        const requestModel = LlamaIndexWrapper._extractModel(this);
        const { address, port } = LlamaIndexWrapper._extractServerInfo(
          this?.llm || this?._llm || this,
        );
        const spanName = `${operationType} ${endpoint}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationType,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();

          const onSuccess = (response: any) => {
            try {
              const duration = (Date.now() - startTime) / 1000;

              BaseWrapper.setBaseSpanAttributes(span, {
                genAIEndpoint: endpoint,
                model: requestModel,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
              span.setAttribute(
                SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration,
              );

              const sourceNodes = response?.sourceNodes || response?.source_nodes || [];
              if (sourceNodes.length > 0) {
                span.setAttribute(
                  SemanticConvention.GEN_AI_RETRIEVAL_SOURCE,
                  JSON.stringify(
                    sourceNodes.slice(0, 5).map((n: any) => ({
                      id: n.node?.id_ || n.id_ || '',
                      score: n.score,
                      text: n.node?.text?.slice(0, 200) || '',
                    })),
                  ),
                );
              }

              if (OpenlitConfig.captureMessageContent) {
                const queryStr = typeof args[0] === 'string'
                  ? args[0]
                  : args[0]?.query || args[0]?.queryStr || '';
                span.setAttribute(
                  SemanticConvention.GEN_AI_INPUT_MESSAGES,
                  OpenLitHelper.buildInputMessages([{ role: 'user', content: queryStr }]),
                );
                const responseText = typeof response?.response === 'string'
                  ? response.response
                  : response?.message?.content || response?.toString?.() || '';
                span.setAttribute(
                  SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                  OpenLitHelper.buildOutputMessages(responseText, 'stop'),
                );
              }

              BaseWrapper.recordMetrics(span, {
                genAIEndpoint: endpoint,
                model: requestModel,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
            } catch { /* swallow */ }
            span.end();
            return response;
          };

          const onError = (e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint: endpoint,
              model: requestModel,
              aiSystem: LlamaIndexWrapper.aiSystem,
              serverAddress: address,
              serverPort: port,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          };

          try {
            const result = originalMethod.apply(this, args);
            if (result && typeof result.then === 'function') {
              return (result as Promise<any>).then(onSuccess).catch(onError);
            }
            return onSuccess(result);
          } catch (e: any) {
            return onError(e);
          }
        });
      };
    };
  }

  // ---------------------------------------------------------------------------
  // Chat engine chat patch — framework span with chat content
  // Mirrors Python: chat engine operations -> operation_type "invoke_workflow"
  // ---------------------------------------------------------------------------

  static _patchChatEngineChat(tracer: Tracer): any {
    const endpoint = 'chat_engine_chat';
    const operationType = SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK;

    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        const requestModel = LlamaIndexWrapper._extractModel(this);
        const { address, port } = LlamaIndexWrapper._extractServerInfo(
          this?.llm || this?._llm || this,
        );
        const workflowName = (this as any)?.constructor?.name || 'chat_engine';
        const spanName = `${operationType} ${workflowName}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.INTERNAL,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationType,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
            [SemanticConvention.GEN_AI_WORKFLOW_NAME]: workflowName,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();

          const onSuccess = (response: any) => {
            try {
              const duration = (Date.now() - startTime) / 1000;

              BaseWrapper.setBaseSpanAttributes(span, {
                genAIEndpoint: endpoint,
                model: requestModel,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
              span.setAttribute(
                SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration,
              );

              if (OpenlitConfig.captureMessageContent) {
                const messageInput = args[0];
                const message = typeof messageInput === 'string'
                  ? messageInput
                  : messageInput?.message || messageInput?.content || '';
                span.setAttribute(
                  SemanticConvention.GEN_AI_INPUT_MESSAGES,
                  OpenLitHelper.buildInputMessages([{ role: 'user', content: message }]),
                );
                const responseContent =
                  response?.message?.content
                  || (typeof response?.response === 'string' ? response.response : '')
                  || response?.toString?.() || '';
                span.setAttribute(
                  SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
                  OpenLitHelper.buildOutputMessages(responseContent, 'stop'),
                );
              }

              BaseWrapper.recordMetrics(span, {
                genAIEndpoint: endpoint,
                model: requestModel,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
            } catch { /* swallow */ }
            span.end();
            return response;
          };

          const onError = (e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint: endpoint,
              model: requestModel,
              aiSystem: LlamaIndexWrapper.aiSystem,
              serverAddress: address,
              serverPort: port,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          };

          try {
            const result = originalMethod.apply(this, args);
            if (result && typeof result.then === 'function') {
              return (result as Promise<any>).then(onSuccess).catch(onError);
            }
            return onSuccess(result);
          } catch (e: any) {
            return onError(e);
          }
        });
      };
    };
  }

  // ---------------------------------------------------------------------------
  // Retriever retrieve patch — retrieval span
  // Mirrors Python: BaseRetriever.retrieve -> operation_type "retrieval"
  // ---------------------------------------------------------------------------

  static _patchRetrieverRetrieve(tracer: Tracer): any {
    const endpoint = 'retriever_retrieve';
    const operationType = OPERATION_MAP[endpoint];

    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
        const spanName = `${operationType} ${endpoint}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationType,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();
          const model = LlamaIndexWrapper._extractModel(this);

          const onSuccess = (response: any) => {
            try {
              const duration = (Date.now() - startTime) / 1000;

              BaseWrapper.setBaseSpanAttributes(span, {
                genAIEndpoint: endpoint,
                model,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
              span.setAttribute(
                SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration,
              );

              if (Array.isArray(response) && response.length > 0) {
                span.setAttribute(
                  SemanticConvention.GEN_AI_RETRIEVAL_SOURCE,
                  JSON.stringify(
                    response.slice(0, 5).map((n: any) => ({
                      id: n.node?.id_ || n.id_ || '',
                      score: n.score,
                      text: n.node?.text?.slice(0, 200) || n.text?.slice(0, 200) || '',
                    })),
                  ),
                );
              }

              if (OpenlitConfig.captureMessageContent) {
                const queryStr = typeof args[0] === 'string'
                  ? args[0]
                  : args[0]?.query || args[0]?.queryStr || '';
                span.setAttribute(
                  SemanticConvention.GEN_AI_INPUT_MESSAGES,
                  OpenLitHelper.buildInputMessages([{ role: 'user', content: queryStr }]),
                );
              }

              BaseWrapper.recordMetrics(span, {
                genAIEndpoint: endpoint,
                model,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
            } catch { /* swallow */ }
            span.end();
            return response;
          };

          const onError = (e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint: endpoint,
              model,
              aiSystem: LlamaIndexWrapper.aiSystem,
              serverAddress: address,
              serverPort: port,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          };

          try {
            const result = originalMethod.apply(this, args);
            if (result && typeof result.then === 'function') {
              return (result as Promise<any>).then(onSuccess).catch(onError);
            }
            return onSuccess(result);
          } catch (e: any) {
            return onError(e);
          }
        });
      };
    };
  }

  // ---------------------------------------------------------------------------
  // Embedding patch — embeddings span
  // Mirrors Python: BaseEmbedding.get_text_embedding_batch -> "embeddings"
  // ---------------------------------------------------------------------------

  static _patchEmbedding(tracer: Tracer, endpoint: string = 'embedding_generate'): any {
    const operationType = OPERATION_MAP[endpoint] || SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING;

    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        const model = LlamaIndexWrapper._extractModel(this);
        const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
        const spanName = `${operationType} ${endpoint}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationType,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
            [SemanticConvention.GEN_AI_REQUEST_MODEL]: model,
            [SemanticConvention.SERVER_ADDRESS]: address,
            [SemanticConvention.SERVER_PORT]: port,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();

          const onSuccess = (response: any) => {
            try {
              const duration = (Date.now() - startTime) / 1000;

              BaseWrapper.setBaseSpanAttributes(span, {
                genAIEndpoint: endpoint,
                model,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
              span.setAttribute(
                SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration,
              );

              if (Array.isArray(response) && response.length > 0) {
                if (Array.isArray(response[0])) {
                  span.setAttribute(
                    SemanticConvention.GEN_AI_EMBEDDINGS_DIMENSION_COUNT,
                    response[0].length,
                  );
                } else if (typeof response[0] === 'number') {
                  span.setAttribute(
                    SemanticConvention.GEN_AI_EMBEDDINGS_DIMENSION_COUNT,
                    response.length,
                  );
                }
              }

              BaseWrapper.recordMetrics(span, {
                genAIEndpoint: endpoint,
                model,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
            } catch { /* swallow */ }
            span.end();
            return response;
          };

          const onError = (e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint: endpoint,
              model,
              aiSystem: LlamaIndexWrapper.aiSystem,
              serverAddress: address,
              serverPort: port,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          };

          try {
            const result = runWithFrameworkLlm(() => originalMethod.apply(this, args));
            if (result && typeof (result as any).then === 'function') {
              return (result as Promise<any>).then(onSuccess).catch(onError);
            }
            return onSuccess(result);
          } catch (e: any) {
            return onError(e);
          }
        });
      };
    };
  }

  // ---------------------------------------------------------------------------
  // Generic framework method patch — for index, document, synthesizer, etc.
  // Mirrors Python: common_llamaindex_logic with framework-level attributes
  // ---------------------------------------------------------------------------

  static _patchFrameworkMethod(tracer: Tracer, endpoint: string): any {
    const operationType =
      OPERATION_MAP[endpoint] || SemanticConvention.GEN_AI_OPERATION_TYPE_FRAMEWORK;

    return (originalMethod: (...args: any[]) => any) => {
      return function (this: any, ...args: any[]) {
        const { address, port } = LlamaIndexWrapper._extractServerInfo(this);
        const spanName = `${operationType} ${endpoint}`;

        const span = tracer.startSpan(spanName, {
          kind: SpanKind.CLIENT,
          attributes: {
            [SemanticConvention.GEN_AI_OPERATION]: operationType,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: LlamaIndexWrapper.aiSystem,
          },
        });

        return context.with(trace.setSpan(context.active(), span), () => {
          const startTime = Date.now();
          const model = LlamaIndexWrapper._extractModel(this);

          const onSuccess = (response: any) => {
            try {
              const duration = (Date.now() - startTime) / 1000;

              BaseWrapper.setBaseSpanAttributes(span, {
                genAIEndpoint: endpoint,
                model,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
              span.setAttribute(
                SemanticConvention.GEN_AI_CLIENT_OPERATION_DURATION, duration,
              );

              BaseWrapper.recordMetrics(span, {
                genAIEndpoint: endpoint,
                model,
                aiSystem: LlamaIndexWrapper.aiSystem,
                serverAddress: address,
                serverPort: port,
              });
            } catch { /* swallow */ }
            span.end();
            return response;
          };

          const onError = (e: any) => {
            OpenLitHelper.handleException(span, e);
            BaseWrapper.recordMetrics(span, {
              genAIEndpoint: endpoint,
              model,
              aiSystem: LlamaIndexWrapper.aiSystem,
              serverAddress: address,
              serverPort: port,
              errorType: e?.constructor?.name || '_OTHER',
            });
            span.end();
            throw e;
          };

          try {
            const result = originalMethod.apply(this, args);
            if (result && typeof result.then === 'function') {
              return (result as Promise<any>).then(onSuccess).catch(onError);
            }
            return onSuccess(result);
          } catch (e: any) {
            return onError(e);
          }
        });
      };
    };
  }
}
