export async function llmResponseAnthropic({
  prompt,
  model,
  apiKey
}: {
  prompt: string;
  model?: string;
  apiKey?: string;
}): Promise<string> {
  let Anthropic: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Anthropic = require('@anthropic-ai/sdk').default;
  } catch {
    throw new Error(
      "openlit guard/eval features require the '@anthropic-ai/sdk' package. Install it with: npm install @anthropic-ai/sdk"
    );
  }
  const client = new Anthropic({ apiKey });
  const usedModel = model || 'claude-3-opus-20240229';
  const response = await client.messages.create({
    model: usedModel,
    max_tokens: 2000,
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: 0.0,
    // Anthropic does not support response_format, so we expect JSON in text
  });
  if (typeof response.content === 'string') return response.content;
  if (Array.isArray(response.content)) {
    for (const part of response.content) {
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim().startsWith('{')) {
        return part.text;
      }
    }
    return response.content
      .filter((p: { type: string; text?: unknown }) : p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
      .map((p: { text: string }) => p.text)
      .join(' ');
  }
  return '';
}
