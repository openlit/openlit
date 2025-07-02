import { EvalsOptions, EvalsInput, EvalsResult } from './types';
import { formatPrompt, parseLlmResponse } from './utils';
import { llmResponseOpenAI, llmResponseAnthropic } from './llm';
import { recordEvalMetrics } from './metrics';

export abstract class BaseEval {
  protected provider: EvalsOptions['provider'];
  protected apiKey?: string;
  protected model?: string;
  protected baseUrl?: string;
  protected thresholdScore: number;
  protected collectMetrics: boolean;
  protected customCategories?: Record<string, string>;

  constructor(options: EvalsOptions = {}) {
    this.provider = options.provider || 'openai';
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.thresholdScore = options.thresholdScore ?? 0.5;
    this.collectMetrics = options.collectMetrics ?? false;
    this.customCategories = options.customCategories;
  }

  abstract getSystemPrompt(): string;

  async measure(input: EvalsInput): Promise<EvalsResult> {
    const systemPrompt = this.getSystemPrompt();
    const prompt = formatPrompt(systemPrompt, input);
    const response = await this.llmResponse(prompt);
    const result = parseLlmResponse(response);
    if (this.collectMetrics) {
      this.recordMetrics(result);
    }
    return result;
  }

  protected async llmResponse(prompt: string): Promise<string> {
    if (this.provider === 'openai') {
      return llmResponseOpenAI({
        prompt,
        model: this.model,
        apiKey: this.apiKey,
        baseUrl: this.baseUrl
      });
    } else if (this.provider === 'anthropic') {
      return llmResponseAnthropic({
        prompt,
        model: this.model,
        apiKey: this.apiKey
      });
    } else {
      throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }

  protected recordMetrics(result: EvalsResult) {
    recordEvalMetrics(result, this.provider || 'unknown');
  }
}
