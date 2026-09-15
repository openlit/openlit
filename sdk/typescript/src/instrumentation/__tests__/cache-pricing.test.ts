/**
 * Unit tests for cache-aware cost calculation in `OpenLitHelper.getChatModelCost`.
 *
 * Mirrors the Python `test_cache_pricing.py` coverage and validates the two
 * provider token-accounting conventions:
 *   - Anthropic native API -> promptTokens is exclusive of cache tokens.
 *   - OpenAI / LangChain -> promptTokens is inclusive of cache tokens.
 *
 * The same cached tokens must never be billed twice, and models without cache
 * pricing must produce exactly the legacy cost regardless of convention.
 *
 * Also covers instrumentor call-site patterns (claude-agent-sdk inclusive sum,
 * bedrock exclusive, openai cache_write_tokens, strands/cursor heuristic).
 */

import OpenLitHelper from '../../helpers';

const PRICING = {
  chat: {
    'claude-3-5-sonnet-20241022': {
      promptPrice: 0.003,
      completionPrice: 0.015,
      cacheReadPrice: 0.0003,
      cacheCreationPrice: 0.00375,
    },
    'model-no-cache-price': {
      promptPrice: 0.003,
      completionPrice: 0.015,
    },
    'gpt-cache-write': {
      promptPrice: 0.0025,
      completionPrice: 0.01,
      cacheReadPrice: 0.00125,
      cacheCreationPrice: 0.003125,
    },
  },
};

const MODEL = 'claude-3-5-sonnet-20241022';

// 200 uncached + 5000 cache-read + 1000 cache-creation + 300 output
const RAW_INPUT = 200;
const CACHE_READ = 5000;
const CACHE_CREATION = 1000;
const OUTPUT = 300;
const INCLUSIVE_INPUT = RAW_INPUT + CACHE_READ + CACHE_CREATION;

function groundTruth(): number {
  return (
    (RAW_INPUT / 1000) * 0.003 +
    (OUTPUT / 1000) * 0.015 +
    (CACHE_READ / 1000) * 0.0003 +
    (CACHE_CREATION / 1000) * 0.00375
  );
}

describe('OpenLitHelper.getChatModelCost — cache pricing', () => {
  describe('no cache tokens', () => {
    it('matches the legacy formula', () => {
      const cost = OpenLitHelper.getChatModelCost(MODEL, PRICING, 1000, 500);
      expect(cost).toBeCloseTo((1000 / 1000) * 0.003 + (500 / 1000) * 0.015, 10);
    });

    it('returns 0 for an unknown model', () => {
      expect(OpenLitHelper.getChatModelCost('nope', PRICING, 10, 10)).toBe(0);
    });

    it('returns 0 when pricing info is missing', () => {
      expect(OpenLitHelper.getChatModelCost(MODEL, {}, 10, 10)).toBe(0);
    });
  });

  describe('Anthropic convention (promptTokens exclusive of cache)', () => {
    it('adds cache cost on top of the prompt base', () => {
      const cost = OpenLitHelper.getChatModelCost(MODEL, PRICING, 800, 500, 100, 100);
      const expected =
        (800 / 1000) * 0.003 +
        (500 / 1000) * 0.015 +
        (100 / 1000) * 0.0003 +
        (100 / 1000) * 0.00375;
      expect(cost).toBeCloseTo(expected, 10);
    });

    it('leaves the prompt base untouched when no cache price exists', () => {
      const cost = OpenLitHelper.getChatModelCost(
        'model-no-cache-price',
        PRICING,
        800,
        500,
        100,
        100
      );
      expect(cost).toBeCloseTo((800 / 1000) * 0.003 + (500 / 1000) * 0.015, 10);
    });
  });

  describe('OpenAI / LangChain convention (promptTokens inclusive of cache)', () => {
    it('does not bill cache tokens twice', () => {
      // 1000 total input = 800 uncached + 100 cache read + 100 cache creation
      const cost = OpenLitHelper.getChatModelCost(MODEL, PRICING, 1000, 500, 100, 100, true);
      const expected =
        (800 / 1000) * 0.003 +
        (500 / 1000) * 0.015 +
        (100 / 1000) * 0.0003 +
        (100 / 1000) * 0.00375;
      expect(cost).toBeCloseTo(expected, 10);
    });

    it('matches the exclusive call describing the same request', () => {
      const inclusive = OpenLitHelper.getChatModelCost(MODEL, PRICING, 1000, 500, 100, 100, true);
      const exclusive = OpenLitHelper.getChatModelCost(MODEL, PRICING, 800, 500, 100, 100);
      expect(inclusive).toBeCloseTo(exclusive, 10);
    });

    it('matches the legacy total when no cache price exists (no regression)', () => {
      const cost = OpenLitHelper.getChatModelCost(
        'model-no-cache-price',
        PRICING,
        1000,
        500,
        100,
        100,
        true
      );
      expect(cost).toBeCloseTo((1000 / 1000) * 0.003 + (500 / 1000) * 0.015, 10);
    });

    it('handles OpenAI-style cache read only (no cache creation)', () => {
      // OpenAI: prompt_tokens includes cached_tokens; no cache-creation charge.
      const pricing = {
        chat: { 'gpt-cache': { promptPrice: 0.0025, completionPrice: 0.01, cacheReadPrice: 0.00125 } },
      };
      const cost = OpenLitHelper.getChatModelCost('gpt-cache', pricing, 1000, 200, 400, 0, true);
      const expected = (600 / 1000) * 0.0025 + (200 / 1000) * 0.01 + (400 / 1000) * 0.00125;
      expect(cost).toBeCloseTo(expected, 10);
    });

    it('clamps the prompt base at 0 for malformed token data', () => {
      const cost = OpenLitHelper.getChatModelCost(MODEL, PRICING, 100, 0, 200, 200, true);
      const expected = (200 / 1000) * 0.0003 + (200 / 1000) * 0.00375;
      expect(cost).toBeCloseTo(expected, 10);
    });
  });

  describe('instrumentor call-site patterns', () => {
    it('claude-agent-sdk: inclusive sum + cache args re-prices correctly', () => {
      // extractUsage builds input = raw + cache_read + cache_creation
      const cost = OpenLitHelper.getChatModelCost(
        MODEL,
        PRICING,
        INCLUSIVE_INPUT,
        OUTPUT,
        CACHE_READ,
        CACHE_CREATION,
        true
      );
      expect(cost).toBeCloseTo(groundTruth(), 10);
    });

    it('bedrock: exclusive cacheRead/cacheWrite does not undercharge', () => {
      const cost = OpenLitHelper.getChatModelCost(
        MODEL,
        PRICING,
        RAW_INPUT,
        OUTPUT,
        CACHE_READ,
        CACHE_CREATION,
        false
      );
      expect(cost).toBeCloseTo(groundTruth(), 10);
    });

    it('openai: maps cache_write_tokens into creation (inclusive)', () => {
      // prompt_tokens inclusive; cache_write_tokens billed at cacheCreationPrice
      const cost = OpenLitHelper.getChatModelCost(
        'gpt-cache-write',
        PRICING,
        1000,
        200,
        400,
        100,
        true
      );
      const expected =
        (500 / 1000) * 0.0025 +
        (200 / 1000) * 0.01 +
        (400 / 1000) * 0.00125 +
        (100 / 1000) * 0.003125;
      expect(cost).toBeCloseTo(expected, 10);
    });

    it('strands/cursor heuristic: input >= cache sum → inclusive', () => {
      const cacheTotal = CACHE_READ + CACHE_CREATION;
      const inclusive = INCLUSIVE_INPUT >= cacheTotal;
      expect(inclusive).toBe(true);
      const cost = OpenLitHelper.getChatModelCost(
        MODEL,
        PRICING,
        INCLUSIVE_INPUT,
        OUTPUT,
        CACHE_READ,
        CACHE_CREATION,
        inclusive
      );
      expect(cost).toBeCloseTo(groundTruth(), 10);
    });

    it('strands/cursor heuristic: input < cache sum → exclusive', () => {
      const cacheTotal = CACHE_READ + CACHE_CREATION;
      const inclusive = RAW_INPUT >= cacheTotal;
      expect(inclusive).toBe(false);
      const cost = OpenLitHelper.getChatModelCost(
        MODEL,
        PRICING,
        RAW_INPUT,
        OUTPUT,
        CACHE_READ,
        CACHE_CREATION,
        inclusive
      );
      expect(cost).toBeCloseTo(groundTruth(), 10);
    });

    it('billing inclusive total at prompt price overcharges (documents pre-fix)', () => {
      const overcharged = OpenLitHelper.getChatModelCost(
        MODEL,
        PRICING,
        INCLUSIVE_INPUT,
        OUTPUT
      );
      expect(overcharged).toBeCloseTo(
        (INCLUSIVE_INPUT / 1000) * 0.003 + (OUTPUT / 1000) * 0.015,
        10
      );
      expect(overcharged).toBeGreaterThan(groundTruth());
    });
  });
});
