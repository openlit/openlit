// js-tiktoken uses WASM + TextEncoder which is not available in jsdom
jest.mock('js-tiktoken', () => ({
  encodingForModel: jest.fn((model: string) => {
    if (model === 'not-a-real-model-xyz') throw new Error(`Unknown model: ${model}`);
    return {
      // Approximate: 1 token per 4 chars
      encode: (text: string) => Array.from({ length: Math.ceil(text.length / 4) }),
    };
  }),
}));

import OpenLitHelper from '@/helpers/server/openlit';

describe('OpenLitHelper', () => {
  describe('PROMPT_TOKEN_FACTOR', () => {
    it('is 1000', () => {
      expect(OpenLitHelper.PROMPT_TOKEN_FACTOR).toBe(1000);
    });
  });

  describe('openaiTokens', () => {
    it('returns token count for a simple string with a known model', () => {
      const count = OpenLitHelper.openaiTokens('Hello, world!', 'gpt-3.5-turbo');
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThan(0);
    });

    it('returns more tokens for longer text', () => {
      const short = OpenLitHelper.openaiTokens('Hi', 'gpt-3.5-turbo');
      const long = OpenLitHelper.openaiTokens(
        'This is a much longer sentence with many more words.',
        'gpt-3.5-turbo'
      );
      expect(long).toBeGreaterThan(short);
    });

    it('throws for an unknown model', () => {
      expect(() =>
        OpenLitHelper.openaiTokens('hello', 'not-a-real-model-xyz')
      ).toThrow();
    });
  });

  describe('generalTokens', () => {
    it('returns a positive integer for non-empty text', () => {
      const count = OpenLitHelper.generalTokens('Hello, world!');
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThan(0);
    });

    it('returns 0 or small number for empty string', () => {
      const count = OpenLitHelper.generalTokens('');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getChatModelCost', () => {
    beforeEach(() => {
      OpenLitHelper.pricingInfo = {
        chat: {
          'gpt-4': { promptPrice: 0.03, completionPrice: 0.06 },
        },
      };
    });

    it('calculates cost correctly', () => {
      // 100 prompt tokens, 50 completion tokens with gpt-4 pricing
      const cost = OpenLitHelper.getChatModelCost('gpt-4', 100, 50);
      // (100/1000)*0.03 + (50/1000)*0.06 = 0.003 + 0.003 = 0.006
      expect(parseFloat(cost)).toBeCloseTo(0.006, 5);
    });

    it('returns "0" when model is not in pricing info', () => {
      const cost = OpenLitHelper.getChatModelCost('unknown-model', 100, 50);
      expect(cost).toBe('0');
    });

    it('returns "0" when pricingInfo is null', () => {
      OpenLitHelper.pricingInfo = null;
      const cost = OpenLitHelper.getChatModelCost('gpt-4', 100, 50);
      expect(cost).toBe('0');
    });
  });

  describe('getEmbedModelCost', () => {
    beforeEach(() => {
      OpenLitHelper.pricingInfo = {
        embeddings: {
          'text-embedding-ada-002': 0.0001,
        },
      };
    });

    it('calculates embedding cost correctly', () => {
      // 500 tokens * 0.0001 / 1000 = 0.00005
      const cost = OpenLitHelper.getEmbedModelCost('text-embedding-ada-002', 500);
      expect(cost).toBeCloseTo(0.00005, 7);
    });

    it('returns NaN for unknown model (undefined price, no exception thrown)', () => {
      const cost = OpenLitHelper.getEmbedModelCost('unknown-embed-model', 100);
      expect(Number.isNaN(cost)).toBe(true);
    });

    it('returns 0 when pricingInfo is null', () => {
      OpenLitHelper.pricingInfo = null;
      const cost = OpenLitHelper.getEmbedModelCost('text-embedding-ada-002', 100);
      expect(cost).toBe(0);
    });
  });

  describe('getImageModelCost', () => {
    beforeEach(() => {
      OpenLitHelper.pricingInfo = {
        images: {
          'dall-e-3': {
            hd: { '1024x1024': 0.08 },
            standard: { '1024x1024': 0.04 },
          },
        },
      };
    });

    it('returns the correct cost for a model/quality/size combination', () => {
      const cost = OpenLitHelper.getImageModelCost('dall-e-3', '1024x1024', 'hd' as any);
      expect(cost).toBe(0.08);
    });

    it('returns 0 for unknown model', () => {
      const cost = OpenLitHelper.getImageModelCost('unknown-model', '1024x1024', 'hd' as any);
      expect(cost).toBe(0);
    });
  });

  describe('getAudioModelCost', () => {
    beforeEach(() => {
      OpenLitHelper.pricingInfo = {
        audio: {
          'tts-1': 0.015,
        },
      };
    });

    it('calculates audio cost by prompt length', () => {
      const prompt = 'Hello, world!'; // 13 chars
      const cost = OpenLitHelper.getAudioModelCost('tts-1', prompt);
      // (13 / 1000) * 0.015 = 0.000195
      expect(cost).toBeCloseTo(0.000195, 6);
    });

    it('returns NaN for unknown model (undefined price, no exception thrown)', () => {
      const cost = OpenLitHelper.getAudioModelCost('unknown-tts', 'hello');
      expect(Number.isNaN(cost)).toBe(true);
    });
  });

  describe('fetchPricingInfo', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('sets pricingInfo from a successful response', async () => {
      const mockData = { chat: { 'gpt-4': { promptPrice: 0.03, completionPrice: 0.06 } } };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockData),
      });
      await OpenLitHelper.fetchPricingInfo();
      expect(OpenLitHelper.pricingInfo).toEqual(mockData);
    });

    it('returns {} on non-ok HTTP response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      const result = await OpenLitHelper.fetchPricingInfo();
      expect(result).toEqual({});
    });

    it('returns {} on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const result = await OpenLitHelper.fetchPricingInfo();
      expect(result).toEqual({});
    });
  });
});
