import { Span, trace } from '@opentelemetry/api';
import OpenAIWrapper from '../openai/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('OpenAIWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    span.end();
  });

  describe('_chatCompletion', () => {
    it('should call recordMetrics after span ends', async () => {
      const mockArgs = [{ message: 'test message' }];
      const mockResponse = { response_id: '123', meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } } };
      const mockGenAIEndpoint = 'openai.endpoint';

      jest.spyOn(OpenAIWrapper, '_chatCompletionCommonSetter').mockResolvedValue({
        genAIEndpoint: mockGenAIEndpoint,
        model: 'test-model',
        user: 'test-user',
        cost: 0.5,
        aiSystem: 'openai',
      });

      await OpenAIWrapper._chatCompletion({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        response: mockResponse,
        span,
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: mockGenAIEndpoint,
        model: 'test-model',
        user: 'test-user',
        cost: 0.5,
        aiSystem: 'openai',
      });
    });
  });

  describe('_chatCompletionCommonSetter', () => {
    it('should set span attributes and return metric parameters', async () => {
      const mockArgs = [{ message: 'test message', max_tokens: 100, temperature: 0.7 }];
      const mockResult = {
        response_id: '123',
        meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } },
        text: 'response text',
        finishReason: 'stop',
      };
      const mockGenAIEndpoint = 'openai.endpoint';

      jest.spyOn(OpenlitConfig, 'updatePricingJson').mockResolvedValue({});
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      const metricParams = await OpenAIWrapper._chatCompletionCommonSetter({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        result: mockResult,
        span,
      });

      expect(metricParams).toEqual({
        genAIEndpoint: mockGenAIEndpoint,
        model: 'test-model',
        user: 'test-user',
        cost: 0.5,
        aiSystem: 'openai',
      });
    });
  });
});
