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
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl || 'https://api.openai.com/v1',
  });
  const usedModel = model || 'gpt-4o';
  const response = await client.chat.completions.create({
    model: usedModel,
    messages: [
      { role: 'user', content: prompt }
    ],
    temperature: 0.0,
    response_format: { type: 'json_object' }
  });
  if (!response || !response.choices || !response.choices[0] || !response.choices[0].message) {
    console.error('OpenAI API error or unexpected response:', response);
    throw new Error('OpenAI API did not return a valid completion response.');
  }
  return response.choices[0].message.content || '';
}
