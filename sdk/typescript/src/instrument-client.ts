import { diag } from '@opentelemetry/api';
import OpenlitConfig from './config';
import { guardClient } from './guard/integration';
import Instrumentations from './instrumentation';

const CLIENT_SHAPES: [string, (client: any) => boolean][] = [
  ['anthropic', (client) => typeof client?.messages?.create === 'function'],
  ['openai', (client) => typeof client?.chat?.completions?.create === 'function'],
];

/**
 * Patch one client object. This needs no module hooks, so it works in bundled
 * code, and returns the client so it can wrap the constructor call. Guards from
 * `init()` apply to the client too.
 */
export function instrument<T>(client: T): T {
  const match = CLIENT_SHAPES.find(([, isShape]) => isShape(client));
  const provider = match && (Instrumentations.availableInstrumentations as any)[match[0]];
  if (typeof provider?.patchClient !== 'function') {
    diag.warn('OpenLIT: instrument() supports Anthropic and OpenAI clients; this client was left unpatched');
    return client;
  }
  provider.patchClient(client);
  if (OpenlitConfig.guardPipeline) guardClient(client, OpenlitConfig.guardPipeline);
  return client;
}
