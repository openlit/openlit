import { Span, trace } from '@opentelemetry/api';
import OpenAIWrapper from '../openai/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

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
      const mockResponse = {
        response_id: '123',
        meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } },
      };
      const mockGenAIEndpoint = 'openai.endpoint';
      jest
        .spyOn(OpenAIWrapper, '_chatCompletionCommonSetter')
        .mockImplementationOnce(async ({ genAIEndpoint, span }) => {
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
          span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);

          return {
            genAIEndpoint,
            model: 'test-model',
            user: 'test-user',
            cost: 0.5,
            aiSystem: 'openai',
          };
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
      const mockArgs = [
        {
          message: 'test message',
          max_tokens: 100,
          temperature: 0.7,
          top_p: 1,
          user: 'test-user',
          presence_penalty: 2,
          frequency_penalty: 3,
          seed: 3,
          stream: true,
        },
      ];

      const mockResult = {
        response_id: '123',
        meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } },
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        text: 'response text',
        finishReason: 'stop',
        choices: [
          {
            finish_reason: 'stop',
          },
        ],
        model: 'test-model',
      };
      const mockGenAIEndpoint = 'openai.endpoint';

      jest.restoreAllMocks();

      jest.spyOn(OpenlitConfig, 'updatePricingJson').mockResolvedValue({});
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      const metricParams = await OpenAIWrapper._chatCompletionCommonSetter({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 1);
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        100
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_TEMPERATURE,
        0.7
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY,
        2
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        3
      );
      expect(span.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_SEED, 3);
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
        true
      );

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
