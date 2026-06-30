export type LlmResponseFn = (args: {
    prompt: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
}) => Promise<string>;
export declare const llmProviders: Record<string, LlmResponseFn>;
