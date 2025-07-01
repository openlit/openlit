// Utility functions for OpenLIT evals (TypeScript)
import { EvalsResult, EvalsInput } from './types';

export function parseLlmResponse(response: string): EvalsResult {
  try {
    return JSON.parse(response);
  } catch {
    return {
      verdict: 'no',
      evaluation: 'hallucination',
      score: 0,
      classification: 'none',
      explanation: 'Failed to parse model response.'
    };
  }
}

export function formatPrompt(systemPrompt: string, input: EvalsInput): string {
  let prompt = systemPrompt;
  if (input.prompt) prompt += `\nPrompt: ${input.prompt}`;
  if (input.contexts) prompt += `\nContexts: ${input.contexts.join(' | ')}`;
  if (input.text) prompt += `\nText: ${input.text}`;
  return prompt;
}

export function formatCustomCategories(
  customCategories?: Record<string, string>,
  sectionLabel?: string
): string {
  if (!customCategories || Object.keys(customCategories).length === 0) return '';
  const label = sectionLabel ? `Additional ${sectionLabel} Categories:` : 'Additional Categories:';
  const lines = Object.entries(customCategories).map(
    ([key, value]) => `- ${key}: ${value}`
  );
  return `\n${label}\n${lines.join('\n')}`;
}
