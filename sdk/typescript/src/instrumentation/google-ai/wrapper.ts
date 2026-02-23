import { Span, SpanKind, Tracer, context, trace } from '@opentelemetry/api';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import SemanticConvention from '../../semantic-convention';
import BaseWrapper from '../base-wrapper';

class GoogleAIWrapper extends BaseWrapper {
  static aiSystem = 'google_ai_studio';
  
  static _patchGenerateContent(tracer: Tracer): any {
    const genAIEndpoint = 'google.generativeai.models.generate_content';
    return (originalMethod: (...args: any[]) => any) => {
      return async function (this: any, ...args: any[]) {
        const span = tracer.startSpan(genAIEndpoint, { kind: SpanKind.CLIENT });
        return context
          .with(trace.setSpan(context.active(), span), async () => {
            return originalMethod.apply(this, args);
          })
          .then((response: any) => {
            // generateContentStream returns { stream, response } — stream is on .stream
            if (response && response.stream && typeof response.stream[Symbol.asyncIterator] === 'function') {
              const wrappedStream = GoogleAIWrapper._generateContentStreamGenerator({
                args,
                genAIEndpoint,
                response: response.stream,
                span,
              });
              return { ...response, stream: wrappedStream };
            }

            return GoogleAIWrapper._generateContent({ args, genAIEndpoint, response, span });
          })
          .catch((e: any) => {
            OpenLitHelper.handleException(span, e);
            span.end();
            throw e;
          });
      };
    };
  }

  static async _generateContent({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }): Promise<any> {
    let metricParams;
    try {
      metricParams = await GoogleAIWrapper._generateContentCommonSetter({
        args,
        genAIEndpoint,
        result: response,
        span,
      });
      return response;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
      throw e;
    } finally {
      span.end();
      if (metricParams) {
        BaseWrapper.recordMetrics(span, metricParams);
      }
    }
  }

  static async *_generateContentStreamGenerator({
    args,
    genAIEndpoint,
    response,
    span,
  }: {
    args: any[];
    genAIEndpoint: string;
    response: any;
    span: Span;
  }): AsyncGenerator<unknown, any, unknown> {
    let metricParams;
    const timestamps: number[] = [];
    const startTime = Date.now();
    
    try {
      const result = {
        model: '',
        text: '',
        candidates: [] as any[],
        usageMetadata: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
          totalTokenCount: 0,
        },
      };
      
      for await (const chunk of response) {
        timestamps.push(Date.now());
        
        if (chunk.modelVersion || chunk.model) {
          result.model = chunk.modelVersion || chunk.model;
        }
        
        const chunkText = typeof chunk.text === 'function' ? chunk.text() : chunk.text;
        if (chunkText) {
          result.text += chunkText;
        }

        if (chunk.candidates && chunk.candidates.length > 0) {
          if (result.candidates.length === 0) {
            result.candidates = chunk.candidates.map((c: any) => ({
              content: { parts: [{ text: '' }], role: 'model' },
              finishReason: c.finishReason || '',
              safetyRatings: c.safetyRatings || [],
            }));
          }
          
          chunk.candidates.forEach((c: any, idx: number) => {
            if (c.content?.parts) {
              c.content.parts.forEach((part: any) => {
                if (part.text) {
                  result.candidates[idx].content.parts[0].text += part.text;
                }
              });
            }
            if (c.finishReason) {
              result.candidates[idx].finishReason = c.finishReason;
            }
          });
        }

        if (chunk.usageMetadata) {
          result.usageMetadata = {
            promptTokenCount: chunk.usageMetadata.promptTokenCount || result.usageMetadata.promptTokenCount,
            candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount || result.usageMetadata.candidatesTokenCount,
            totalTokenCount: chunk.usageMetadata.totalTokenCount || result.usageMetadata.totalTokenCount,
          };
        }

        yield chunk;
      }

      // Calculate TTFT and TBT
      const ttft = timestamps.length > 0 ? (timestamps[0] - startTime) / 1000 : 0;
      let tbt = 0;
      if (timestamps.length > 1) {
        const timeDiffs = timestamps.slice(1).map((t, i) => t - timestamps[i]);
        tbt = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length / 1000;
      }

      metricParams = await GoogleAIWrapper._generateContentCommonSetter({
        args,
        genAIEndpoint,
        result,
        span,
        ttft,
        tbt,
        isStream: true,
      });

      return result;
    } catch (e: any) {
      OpenLitHelper.handleException(span, e);
      throw e;
    } finally {
      span.end();
      if (metricParams) {
        BaseWrapper.recordMetrics(span, metricParams);
      }
    }
  }

  static async _generateContentCommonSetter({
    args,
    genAIEndpoint,
    result,
    span,
    ttft = 0,
    tbt = 0,
    isStream = false,
  }: {
    args: any[];
    genAIEndpoint: string;
    result: any;
    span: Span;
    ttft?: number;
    tbt?: number;
    isStream?: boolean;
  }) {
    const traceContent = OpenlitConfig.traceContent;
    // Non-streaming: result is GenerateContentResult = { response: GenerateContentResponse }
    // Streaming: result is our custom accumulated plain object
    const responseData = result.response || result;
    const config = args[0]?.config || args[1] || {};
    const {
      temperature,
      maxOutputTokens,
      topP,
      topK,
      stopSequences,
    } = config;

    // Request Params attributes
    if (temperature !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, temperature);
    }
    if (maxOutputTokens !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, maxOutputTokens);
    }
    if (topP !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, topP);
    }
    if (topK !== undefined) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_K, topK);
    }
    if (stopSequences) {
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES, stopSequences);
    }
    span.setAttribute(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, isStream);

    if (traceContent) {
      const contents = args[0]?.contents || args[0];
      let messages: any[] = [];
      if (typeof contents === 'string') {
        messages = [{ role: 'user', content: contents }];
      } else if (Array.isArray(contents)) {
        messages = contents.map((item: any) => ({
          role: item.role || 'user',
          content: Array.isArray(item.parts)
            ? item.parts.map((p: any) => p.text || '').join(' ')
            : (item.parts || ''),
        }));
      }
      span.setAttribute(SemanticConvention.GEN_AI_INPUT_MESSAGES, OpenLitHelper.buildInputMessages(messages));
    }

    span.setAttribute(
      SemanticConvention.GEN_AI_OPERATION,
      SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT
    );

    const model = responseData.modelVersion || responseData.model || args[0]?.model || 'gemini-pro';
    const responseModel = model;

    const pricingInfo = await OpenlitConfig.updatePricingJson(OpenlitConfig.pricing_json);

    // Calculate cost of the operation
    const usageMetadata = responseData.usageMetadata;
    const promptTokens = usageMetadata?.promptTokenCount || 0;
    const completionTokens = usageMetadata?.candidatesTokenCount || 0;

    const cost = OpenLitHelper.getChatModelCost(
      model,
      pricingInfo,
      promptTokens,
      completionTokens
    );

    GoogleAIWrapper.setBaseSpanAttributes(span, {
      genAIEndpoint,
      model,
      user: undefined,
      cost,
      aiSystem: GoogleAIWrapper.aiSystem,
    });

    // Response model
    span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_MODEL, responseModel);

    // Token usage
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, promptTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, completionTokens);
    span.setAttribute(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS, usageMetadata?.totalTokenCount || 0);
    span.setAttribute(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, usageMetadata?.totalTokenCount || 0);
    
    // TTFT and TBT metrics
    if (ttft > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TTFT, ttft);
    }
    if (tbt > 0) {
      span.setAttribute(SemanticConvention.GEN_AI_SERVER_TBT, tbt);
    }

    // Finish reason
    if (responseData.candidates && responseData.candidates[0]?.finishReason) {
      span.setAttribute(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        [responseData.candidates[0].finishReason]
      );
    }

    // Output type
    span.setAttribute(SemanticConvention.GEN_AI_OUTPUT_TYPE, SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT);

    // Content
    if (traceContent) {
      const completionContent = (typeof responseData.text === 'function' ? responseData.text() : responseData.text) ||
        (responseData.candidates?.[0]?.content?.parts?.[0]?.text) || '';
      const finishReason = responseData.candidates?.[0]?.finishReason || 'stop';
      span.setAttribute(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        OpenLitHelper.buildOutputMessages(completionContent, finishReason)
      );
    }

    return {
      genAIEndpoint,
      model,
      user: undefined,
      cost,
      aiSystem: GoogleAIWrapper.aiSystem,
    };
  }
}

export default GoogleAIWrapper;
