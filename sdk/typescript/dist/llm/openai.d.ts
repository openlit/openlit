export declare function llmResponseOpenAI({ prompt, model, apiKey, baseUrl }: {
    prompt: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
}): Promise<string>;
