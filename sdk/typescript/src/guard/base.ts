import { GuardConfig } from './types';

export abstract class BaseGuard {
  protected provider?: GuardConfig['provider'];
  protected apiKey?: string;
  protected model?: string;
  protected baseUrl?: string;
  protected thresholdScore: number;
  protected collectMetrics: boolean;
  protected customRules?: GuardConfig['customRules'];
  protected validTopics?: string[];
  protected invalidTopics?: string[];

  constructor(config: GuardConfig = {}) {
    this.provider = config.provider;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
    this.thresholdScore = config.thresholdScore ?? 0.25;
    this.collectMetrics = config.collectMetrics ?? false;
    this.customRules = config.customRules;
    this.validTopics = config.validTopics;
    this.invalidTopics = config.invalidTopics;
  }

  protected abstract getSystemPrompt(): string;

  protected async llmResponse(prompt: string): Promise<string> {
    if (!this.provider) throw new Error('No provider specified');
    const { llmProviders } = await import('../llm/providers');
    const providerFn = llmProviders[this.provider];
    if (!providerFn) throw new Error(`Unsupported provider: ${this.provider}`);
    return providerFn({
      prompt,
      model: this.model,
      apiKey: this.apiKey,
      baseUrl: this.baseUrl
    });
  }
}
