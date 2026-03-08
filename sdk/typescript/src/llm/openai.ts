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
  if (!response) {
    console.error('OpenAI API did not return a response object:', response);
    throw new Error('OpenAI API did not return a response object.');
  }
  if (!response.choices) {
    console.error('OpenAI API response missing "choices":', response);
    throw new Error('OpenAI API response missing "choices".');
  }
  if (!Array.isArray(response.choices) || response.choices.length === 0) {
    console.error('OpenAI API response "choices" is empty or not an array:', response.choices);
    throw new Error('OpenAI API response "choices" is empty or not an array.');
  }
  if (!response.choices[0]) {
    console.error('OpenAI API response "choices[0]" is missing:', response.choices);
    throw new Error('OpenAI API response "choices[0]" is missing.');
  }
  if (!response.choices[0].message) {
    console.error('OpenAI API response "choices[0].message" is missing:', response.choices[0]);
    throw new Error('OpenAI API response "choices[0].message" is missing.');
  }
  if (typeof response.choices[0].message.content !== 'string') {
    console.error('OpenAI API response "choices[0].message.content" is missing or not a string:', response.choices[0].message);
    throw new Error('OpenAI API response "choices[0].message.content" is missing or not a string.');
  }
  return response.choices[0].message.content || '';
}
