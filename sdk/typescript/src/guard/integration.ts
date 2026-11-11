/**
 * Auto-guard integration layer.
 *
 * setupAutoGuards wraps LLM provider methods so that guards run on every
 * call without any changes to existing instrumentation code.
 *
 * Call chain after setup:
 *
 *   User call
 *     -> Guard wrapper  (preflight -> may deny/redact)
 *       -> Instrumentor wrapper  (OTel telemetry)
 *         -> Original SDK method  (actual API call)
 *       <- Instrumentor wrapper
 *     <- Guard wrapper  (postflight -> may redact/warn)
 *   <- Returns to user
 *
 * **Streaming limitation**: postflight guards require a complete response
 * object with `choices[].message.content` (or equivalent). Streaming
 * responses yield incremental chunks that extractors cannot fully
 * reassemble, so postflight guards are silently skipped for streamed
 * completions. Preflight guards always run.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/_integration.py
 */

import type { OpenlitInstrumentations } from '../types';
import { Guard, GuardAction, GuardDeniedError } from './base';
import { Pipeline } from './pipeline';
import OpenlitConfig from '../config';

// ---------------------------------------------------------------------------
// Provider-specific text extractors
// ---------------------------------------------------------------------------

type Extractor = (arg: any) => string;

export function extractOpenAIInput(kwargs: Record<string, any>): string {
  const messages = kwargs.messages || kwargs.input || [];
  if (typeof messages === 'string') return messages;
  const parts: string[] = [];
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (typeof m === 'object' && m !== null) {
        const content = m.content ?? '';
        if (typeof content === 'string') parts.push(content);
      } else if (typeof m === 'string') {
        parts.push(m);
      }
    }
  }
  return parts.join(' ');
}

export function extractOpenAIOutput(response: any): string {
  try {
    const choices = response?.choices;
    if (choices && Array.isArray(choices)) {
      return choices
        .map((c: any) => c?.message?.content || '')
        .join(' ');
    }
    const output = response?.output;
    if (output && Array.isArray(output)) {
      const parts: string[] = [];
      for (const item of output) {
        const content = item?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const text = block?.text;
            if (text) parts.push(text);
          }
        } else if (typeof content === 'string') {
          parts.push(content);
        }
      }
      return parts.join(' ');
    }
  } catch {
    // ignore
  }
  return '';
}

export function extractAnthropicInput(kwargs: Record<string, any>): string {
  const messages = kwargs.messages || [];
  const parts: string[] = [];
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (typeof m === 'object' && m !== null) {
        const content = m.content ?? '';
        if (typeof content === 'string') {
          parts.push(content);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block?.type === 'text') {
              parts.push(block.text || '');
            }
          }
        }
      }
    }
  }
  return parts.join(' ');
}

export function extractAnthropicOutput(response: any): string {
  try {
    const content = response?.content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        const text = block?.text;
        if (text) parts.push(text);
      }
      return parts.join(' ');
    }
  } catch {
    // ignore
  }
  return '';
}

export function extractGenericInput(kwargs: Record<string, any>): string {
  for (const key of ['messages', 'message', 'prompt', 'input', 'text']) {
    const val = kwargs[key];
    if (val == null) continue;
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) {
      const parts: string[] = [];
      for (const item of val) {
        if (typeof item === 'string') {
          parts.push(item);
        } else if (typeof item === 'object' && item !== null) {
          parts.push(item.content || '');
        }
      }
      return parts.join(' ');
    }
  }
  return '';
}

export function extractGenericOutput(response: any): string {
  try {
    const choices = response?.choices;
    if (choices && Array.isArray(choices)) {
      return choices
        .map((c: any) => c?.message?.content || '')
        .join(' ');
    }
  } catch {
    // ignore
  }
  try {
    const content = response?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        const text = block?.text;
        if (text) parts.push(text);
      }
      if (parts.length) return parts.join(' ');
    }
  } catch {
    // ignore
  }
  try {
    if (response?.text) return response.text;
  } catch {
    // ignore
  }
  return '';
}

// ---------------------------------------------------------------------------
// Methods to guard: (npmPackage, protoPath, methodName, inputExtractor, outputExtractor)
// ---------------------------------------------------------------------------

interface GuardedMethod {
  npmPackage: string;
  protoPath: string[];
  methodName: string;
  extractInput: Extractor;
  extractOutput: Extractor;
}

const GUARDED_METHODS: GuardedMethod[] = [
  // OpenAI
  { npmPackage: 'openai', protoPath: ['OpenAI', 'Chat', 'Completions', 'prototype'], methodName: 'create', extractInput: extractOpenAIInput, extractOutput: extractOpenAIOutput },
  { npmPackage: 'openai', protoPath: ['OpenAI', 'Responses', 'prototype'], methodName: 'create', extractInput: extractOpenAIInput, extractOutput: extractOpenAIOutput },
  // Anthropic
  { npmPackage: '@anthropic-ai/sdk', protoPath: ['Anthropic', 'Messages', 'prototype'], methodName: 'create', extractInput: extractAnthropicInput, extractOutput: extractAnthropicOutput },
  { npmPackage: '@anthropic-ai/sdk', protoPath: ['Anthropic', 'Beta', 'Messages', 'prototype'], methodName: 'create', extractInput: extractAnthropicInput, extractOutput: extractAnthropicOutput },
  // Groq
  { npmPackage: 'groq-sdk', protoPath: ['Groq', 'Chat', 'Completions', 'prototype'], methodName: 'create', extractInput: extractGenericInput, extractOutput: extractGenericOutput },
  // Mistral
  { npmPackage: '@mistralai/mistralai', protoPath: ['Mistral', 'chat', 'prototype'], methodName: 'complete', extractInput: extractGenericInput, extractOutput: extractGenericOutput },
  // Cohere
  { npmPackage: 'cohere-ai', protoPath: ['CohereClientV2', 'prototype'], methodName: 'chat', extractInput: extractGenericInput, extractOutput: extractGenericOutput },
  // Together
  { npmPackage: 'together-ai', protoPath: ['Together', 'Chat', 'Completions', 'prototype'], methodName: 'create', extractInput: extractGenericInput, extractOutput: extractGenericOutput },
  // Bedrock (AWS)
  { npmPackage: '@aws-sdk/client-bedrock-runtime', protoPath: ['BedrockRuntimeClient', 'prototype'], methodName: 'send', extractInput: extractGenericInput, extractOutput: extractGenericOutput },
  // Google Generative AI
  { npmPackage: '@google/generative-ai', protoPath: ['GenerativeModel', 'prototype'], methodName: 'generateContent', extractInput: extractGenericInput, extractOutput: extractGenericOutput },
];

// ---------------------------------------------------------------------------
// Preflight / Postflight
// ---------------------------------------------------------------------------

function applyPreflight(
  pipeline: Pipeline,
  kwargs: Record<string, any>,
  extractInput: Extractor,
): Record<string, any> {
  const inputText = extractInput(kwargs);
  if (!inputText) return kwargs;

  const result = pipeline.evaluate(inputText, 'preflight');

  if (result.action === GuardAction.DENY) {
    throw new GuardDeniedError(result);
  }

  if (result.action === GuardAction.REDACT && result.transformedText !== null) {
    for (const key of ['messages', 'input', 'prompt', 'text']) {
      if (key in kwargs) {
        const original = kwargs[key];
        if (typeof original === 'string') {
          return { ...kwargs, [key]: result.transformedText };
        }
        if (Array.isArray(original) && original.length > 0) {
          const newMessages = [...original];
          const last = newMessages[newMessages.length - 1];
          if (typeof last === 'object' && last !== null && 'content' in last) {
            newMessages[newMessages.length - 1] = { ...last, content: result.transformedText };
            return { ...kwargs, [key]: newMessages };
          }
        }
        break;
      }
    }
  }

  return kwargs;
}

function applyPostflight(
  pipeline: Pipeline,
  response: any,
  extractOutput: Extractor,
): any {
  const outputText = extractOutput(response);
  if (!outputText) return response;

  const result = pipeline.evaluate(outputText, 'postflight');

  if (result.action === GuardAction.DENY) {
    throw new GuardDeniedError(result);
  }

  if (result.action === GuardAction.REDACT && result.transformedText !== null) {
    try {
      const choices = response?.choices;
      if (choices && Array.isArray(choices)) {
        for (const choice of choices) {
          if (choice?.message && 'content' in choice.message) {
            choice.message.content = result.transformedText;
          }
        }
      } else {
        const content = response?.content;
        if (Array.isArray(content) && content.length > 0) {
          for (const block of content) {
            if ('text' in block) {
              block.text = result.transformedText;
              break;
            }
          }
        } else if (response && 'text' in response) {
          response.text = result.transformedText;
        }
      }
    } catch {
      // best-effort redaction
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Prototype resolver
// ---------------------------------------------------------------------------

function walk(root: any, path: string[]): any {
  let obj = root;
  for (const key of path) {
    if (obj == null) return null;
    obj = obj[key];
  }
  return obj;
}

// A namespace import has `.Anthropic`. A default import is the class itself, so
// the path starts one level lower.
function resolveProto(moduleExports: any, protoPath: string[]): any {
  return walk(moduleExports, protoPath) ?? walk(moduleExports, protoPath.slice(1));
}

const GUARDED = Symbol.for('openlit.guarded');

/**
 * A denied call returns this, not a bare rejected promise. The clients' own
 * helpers (`stream()`, `parse()`) call `withResponse()` or `_thenUnwrap()` on
 * what `create()` returns, and a bare promise would make them throw a TypeError
 * and leave this rejection unhandled, which ends a Node process. It is marked
 * handled because the helpers may never await it; callers that do still get it.
 */
function deniedCall(error: unknown): Promise<never> {
  const denied: any = Promise.reject(error);
  denied.catch(() => undefined);
  denied.withResponse = () => denied;
  denied.asResponse = () => denied;
  denied._thenUnwrap = () => denied;
  return denied;
}

/**
 * Runs in sync so a client's `APIPromise` reaches the caller: the clients' own
 * `stream()` helpers call `.withResponse()` on what `create()` returns. The
 * pipeline is read on every call, so a method wrapped before `init()`, or before
 * the guards change, still uses the current guards.
 */
function guardMethod(
  target: any,
  methodName: string,
  extractInput: Extractor,
  extractOutput: Extractor,
): boolean {
  const original = target?.[methodName];
  if (typeof original !== 'function' || original[GUARDED]) return false;

  const guarded = function (this: any, ...args: any[]) {
    const pipeline: Pipeline | undefined = OpenlitConfig.guardPipeline;
    if (!pipeline) return original.apply(this, args);
    try {
      args[0] = applyPreflight(pipeline, args[0] || {}, extractInput);
    } catch (error) {
      return deniedCall(error);
    }
    const pending = original.apply(this, args);
    const postflight = (response: any) => applyPostflight(pipeline, response, extractOutput);
    return typeof pending?._thenUnwrap === 'function'
      ? pending._thenUnwrap(postflight)
      : Promise.resolve(pending).then(postflight);
  };
  (guarded as any)[GUARDED] = true;
  target[methodName] = guarded;
  return true;
}

const INSTRUMENTATION_KEYS: Record<string, keyof OpenlitInstrumentations> = {
  openai: 'openai',
  '@anthropic-ai/sdk': 'anthropic',
  'groq-sdk': 'groq',
  '@mistralai/mistralai': 'mistral',
  'cohere-ai': 'cohere',
  'together-ai': 'together',
  '@aws-sdk/client-bedrock-runtime': 'bedrock',
  '@google/generative-ai': 'google-ai',
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function setupAutoGuards(
  guards: Guard[],
  failOpen = true,
  modules: OpenlitInstrumentations = {},
): void {
  OpenlitConfig.guardPipeline = new Pipeline({ guards, failOpen });

  let wrappedCount = 0;
  for (const { npmPackage, protoPath, methodName, extractInput, extractOutput } of GUARDED_METHODS) {
    try {
      // Bundled code cannot `require` a provider, so a module passed to
      // `instrumentations` comes first.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = modules[INSTRUMENTATION_KEYS[npmPackage]] ?? require(npmPackage);
      const proto = resolveProto(mod, protoPath);
      if (guardMethod(proto, methodName, extractInput, extractOutput)) wrappedCount++;
    } catch {
      // module not installed, skip silently
    }
  }

  if (wrappedCount > 0) {
    console.log(`[openlit] Auto-guards: wrapped ${wrappedCount}/${GUARDED_METHODS.length} provider methods`);
  } else {
    // A bundle cannot `require` the provider, so this is the usual result there.
    // It goes to the console, not `diag`, so it is seen without a diag logger.
    console.warn(
      '[openlit] Guards are not applied to any provider yet. Pass the provider module to ' +
        '`instrumentations`, or wrap the client with `openlit.instrument()`; until then, calls are not guarded.'
    );
  }
}

/**
 * Guard one client object, for `openlit.instrument()`. The guards come from
 * `init()` at call time, so the client may be wrapped first.
 */
export function guardClient(client: any): void {
  const targets: [any, Extractor, Extractor][] = [
    [client?.messages, extractAnthropicInput, extractAnthropicOutput],
    [client?.beta?.messages, extractAnthropicInput, extractAnthropicOutput],
    [client?.chat?.completions, extractOpenAIInput, extractOpenAIOutput],
    [client?.responses, extractOpenAIInput, extractOpenAIOutput],
  ];
  for (const [target, extractInput, extractOutput] of targets) {
    guardMethod(target, 'create', extractInput, extractOutput);
  }
}
