import { encodingForModel, TiktokenModel } from 'js-tiktoken';
import { Span, SpanStatusCode } from '@opentelemetry/api';

export default class OpenLitHelper {
  static readonly PROMPT_TOKEN_FACTOR = 1000;

  static openaiTokens(text: string, model: string): number {
    try {
      const encoding = encodingForModel(model as TiktokenModel);
      return encoding.encode(text).length;
    } catch {
      return OpenLitHelper.generalTokens(text);
    }
  }

  static generalTokens(text: string): number {
    const encoding = encodingForModel('gpt2');
    return encoding.encode(text).length;
  }

  static getChatModelCost(
    model: string,
    pricingInfo: any,
    promptTokens: number,
    completionTokens: number
  ): number {
    try {
      const cost = (
        (promptTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) * pricingInfo.chat[model].promptPrice +
        (completionTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) *
          pricingInfo.chat[model].completionPrice
      );
      return isNaN(cost) ? 0 : cost;
    } catch (error) {
      console.error(`Error in getChatModelCost: ${error}`);
      return 0;
    }
  }

  static getEmbedModelCost(model: string, pricingInfo: any, promptTokens: number): number {
    try {
      const cost = (promptTokens / OpenLitHelper.PROMPT_TOKEN_FACTOR) * pricingInfo.embeddings[model];
      return isNaN(cost) ? 0 : cost;
    } catch (error) {
      console.error(`Error in getEmbedModelCost: ${error}`);
      return 0;
    }
  }

  static getImageModelCost(model: string, pricingInfo: any, size: string, quality: number): number {
    try {
      const cost = pricingInfo.images[model][quality][size];
      return isNaN(cost) ? 0 : cost;
    } catch (error) {
      console.error(`Error in getImageModelCost: ${error}`);
      return 0;
    }
  }

  static getAudioModelCost(model: string, pricingInfo: any, prompt: string): number {
    try {
      const cost = (prompt.length / OpenLitHelper.PROMPT_TOKEN_FACTOR) * pricingInfo.audio[model];
      return isNaN(cost) ? 0 : cost;
    } catch (error) {
      console.error(`Error in getAudioModelCost: ${error}`);
      return 0;
    }
  }

  static async fetchPricingInfo(pricingJson: any) {
    let pricingUrl = 'https://raw.githubusercontent.com/openlit/openlit/main/assets/pricing.json';
    if (pricingJson) {
      let isUrl = false;
      try {
        isUrl = !!new URL(pricingJson);
      } catch {
        isUrl = false;
      }

      if (isUrl) {
        pricingUrl = pricingJson;
      } else {
        try {
          if (typeof pricingJson === 'string') {
            const json = JSON.parse(pricingJson);
            return json;
          } else {
            const json = JSON.parse(JSON.stringify(pricingJson));
            return json;
          }
        } catch {
          return {};
        }
      }
    }

    try {
      const response = await fetch(pricingUrl);
      if (response.ok) {
        return response.json();
      } else {
        throw new Error(`HTTP error occurred while fetching pricing info: ${response.status}`);
      }
    } catch (error) {
      console.error(`Unexpected error occurred while fetching pricing info: ${error}`);
      return {};
    }
  }

  /**
   * Build OTel-spec input messages JSON string from provider messages array.
   * Format: [{"role": "user", "parts": [{"type": "text", "content": "..."}]}]
   */
  static buildInputMessages(messages: any[], system?: string): string {
    try {
      const otelMessages: any[] = [];

      if (system) {
        otelMessages.push({ role: 'system', parts: [{ type: 'text', content: system }] });
      }

      for (const msg of messages || []) {
        const role = msg.role || 'user';
        const content = msg.content;
        const parts: any[] = [];

        if (typeof content === 'string' && content) {
          parts.push({ type: 'text', content });
        } else if (Array.isArray(content)) {
          for (const item of content) {
            const t = item.type;
            if (t === 'text') {
              parts.push({ type: 'text', content: item.text || '' });
            } else if (t === 'image_url') {
              const url = item.image_url?.url || '';
              if (url && !url.startsWith('data:')) {
                parts.push({ type: 'uri', modality: 'image', uri: url });
              }
            } else if (t === 'image') {
              // Anthropic image format
              const url = item.source?.url || '';
              if (url && !url.startsWith('data:')) {
                parts.push({ type: 'uri', modality: 'image', uri: url });
              }
            } else if (t === 'tool_use') {
              parts.push({ type: 'tool_call', id: item.id || '', name: item.name || '', arguments: item.input || {} });
            } else if (t === 'tool_result') {
              parts.push({ type: 'tool_call_response', id: item.tool_use_id || '', response: typeof item.content === 'string' ? item.content : JSON.stringify(item.content || '') });
            }
          }
        }

        // Handle tool_calls in message (OpenAI assistant format)
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            let args = tc.function?.arguments || {};
            if (typeof args === 'string') {
              try { args = JSON.parse(args); } catch { args = { raw: args }; }
            }
            parts.push({ type: 'tool_call', id: tc.id || '', name: tc.function?.name || '', arguments: args });
          }
        }

        if (parts.length > 0) {
          otelMessages.push({ role, parts });
        }
      }

      return JSON.stringify(otelMessages);
    } catch {
      return '[]';
    }
  }

  /**
   * Build OTel-spec output messages JSON string from provider response.
   * Format: [{"role": "assistant", "parts": [{"type": "text", "content": "..."}], "finish_reason": "stop"}]
   */
  static buildOutputMessages(text: string, finishReason: string, toolCalls?: any[]): string {
    try {
      const parts: any[] = [];

      if (text) {
        parts.push({ type: 'text', content: text });
      }

      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          let args = tc.function?.arguments || tc.arguments || {};
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = { raw: args }; }
          }
          parts.push({
            type: 'tool_call',
            id: tc.id || '',
            name: tc.function?.name || tc.name || '',
            arguments: args,
          });
        }
      }

      return JSON.stringify([{ role: 'assistant', parts, finish_reason: finishReason || 'stop' }]);
    } catch {
      return '[]';
    }
  }

  static handleException(span: Span, error: Error): void {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  }

  static async createStreamProxy (stream: any, generatorFuncResponse: any): Promise<any> {
    return new Proxy(stream, {
      get (target, prop, receiver) {
        if (prop === Symbol.asyncIterator) {
          return () => generatorFuncResponse
        }
        return Reflect.get(target, prop, receiver)
      }
    })
  }
}
