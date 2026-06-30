interface LegacyGuardResult {
    score: number;
    verdict: 'yes' | 'no' | 'none';
    guard: string;
    classification: string;
    explanation: string;
}
export declare function llmResponse(provider: string, prompt: string, model?: string, baseUrl?: string, apiKey?: string): Promise<string>;
export declare function parseLlmResponse(response: string | object): LegacyGuardResult;
export {};
