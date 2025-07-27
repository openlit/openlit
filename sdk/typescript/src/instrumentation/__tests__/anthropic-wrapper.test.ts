import { Span, trace } from '@opentelemetry/api';
import AnthropicWrapper from '../anthropic/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('AnthropicWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    span.end();
  });

  describe('_messageCreate', () => {
    it('should call recordMetrics after span ends', async () => {
      const mockArgs = [{ message: 'test message' }];
      const mockResponse = { response_id: '123', meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } } };

      jest.spyOn(BaseWrapper, 'recordMetrics').mockImplementation(() => {});

      jest.spyOn(AnthropicWrapper, '_messageCreateCommonSetter').mockImplementation(async () => {
        return {
          genAIEndpoint: 'anthropic.endpoint',
          model: 'test-model',
          user: 'test-user',
          cost: 0.5,
          aiSystem: 'anthropic',
        };
      });

      await AnthropicWrapper._messageCreate({
        args: mockArgs,
        genAIEndpoint: 'anthropic.endpoint',
        response: mockResponse,
        span,
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        model: 'test-model',
        user: 'test-user',
        cost: 0.5,
        aiSystem: 'anthropic',
        genAIEndpoint: 'anthropic.endpoint',
      });
    });
  });

  describe('_messageCommonSetter', () => {
    it('should set span attributes and return metric parameters', async () => {
      const mockArgs = [{ message: 'test message', max_tokens: 100, temperature: 0.7 }];
      const mockResult = {
        response_id: '123',
        meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } },
        text: 'response text',
        finishReason: 'stop',
      };

      jest.spyOn(OpenlitConfig, 'updatePricingJson').mockResolvedValue({});
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      await AnthropicWrapper._messageCreateCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'anthropic.endpoint',
        result: mockResult,
        span,
      });
    });
  });
});
