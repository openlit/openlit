/**
 * Everything the SDK takes from Node.js, in one module.
 *
 * The edge build swaps this file for `index.edge.ts` (see
 * `scripts/build-edge.mjs`), so code outside `platform/` imports from here and
 * never from `async_hooks`, `crypto` or `js-tiktoken` directly.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';
import { encodingForModel, TiktokenModel } from 'js-tiktoken';
import type { PricingObject } from '../types';
import type { ContextStore } from './types';

export type { ContextStore, TokenCounter } from './types';

export const IS_EDGE_BUILD = false;

export function createContextStore<T>(): ContextStore<T> {
  return new AsyncLocalStorage<T>();
}

/** False where async context does not survive `await`. Always true on Node. */
export function hasAsyncContext(): boolean {
  return true;
}

export function sha1Hex(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

export function countTokens(text: string, model: string): number {
  return encodingForModel(model as TiktokenModel).encode(text).length;
}

export function pricingSnapshot(): PricingObject | undefined {
  return undefined;
}
