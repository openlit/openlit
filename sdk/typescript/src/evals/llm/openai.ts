import OpenAI from 'openai';

export async function llmResponseOpenAI({
  prompt,
  model,
  apiKey,
  baseUrl
}: {
  prompt: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<string> {
  const forgeApiKey = process.env.FORGE_API_KEY;
  const forgeBaseUrl = process.env.FORGE_API_BASE || 'https://api.forge.tensorblock.co/v1';
  const baseUrlIsForge = Boolean(baseUrl && baseUrl.includes('forge.tensorblock.co'));
  const useForge = baseUrlIsForge || (!apiKey && !baseUrl && Boolean(forgeApiKey));
  const resolvedBaseUrl = baseUrl || (useForge ? forgeBaseUrl : 'https://api.openai.com/v1');
  const resolvedApiKey = useForge ? (apiKey || forgeApiKey) : apiKey;
  const client = new OpenAI({
    apiKey: resolvedApiKey,
    baseURL: resolvedBaseUrl,
  });
  const usedModel = model || (useForge ? 'OpenAI/gpt-4o-mini' : 'gpt-4o');
  const response = await client.chat.completions.create({
    model: usedModel,
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: 0.0,
    response_format: { type: 'json_object' }
  });
  return response.choices[0].message.content || '';
}
