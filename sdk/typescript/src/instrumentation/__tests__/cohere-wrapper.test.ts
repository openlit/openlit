import { Span, trace } from '@opentelemetry/api';
import CohereWrapper from '../cohere/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../../src/config');
jest.mock('../../../src/helpers');
jest.mock('../../../src/instrumentation/base-wrapper');

const mockTracer = trace.getTracer('test-tracer');

describe('CohereWrapper', () => {
  let span: Span;

  beforeEach(() => {
    span = mockTracer.startSpan('test-span');
    span.setAttribute = jest.fn();
    span.addEvent = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    span.end();
  });

  describe('_chat', () => {
    it('should call recordMetrics after span ends', async () => {
      const mockArgs = [{ model: 'command-r-plus', message: 'test message' }];
      const mockResponse = {
        response_id: '123',
        text: 'response text',
        finishReason: 'stop',
        meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } },
      };
      const mockGenAIEndpoint = 'cohere.chat';

      jest
        .spyOn(CohereWrapper, '_chatCommonSetter')
        .mockImplementationOnce(async ({ genAIEndpoint, span: s }) => {
          s.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 1);

          return {
            genAIEndpoint,
            model: 'command-r-plus',
            user: 'test-user',
            cost: 0.5,
            aiSystem: 'cohere',
          };
        });

      await CohereWrapper._chat({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        response: mockResponse,
        span,
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: mockGenAIEndpoint,
        model: 'command-r-plus',
        user: 'test-user',
        cost: 0.5,
        aiSystem: 'cohere',
      });
    });

    it('should rethrow errors from _chatCommonSetter', async () => {
      const mockArgs = [{ model: 'command-r-plus', message: 'test message' }];
      const mockResponse = {
        response_id: '123',
        meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } },
      };

      jest.spyOn(CohereWrapper, '_chatCommonSetter').mockRejectedValue(new Error('Test error'));

      await expect(
        CohereWrapper._chat({
          args: mockArgs,
          genAIEndpoint: 'cohere.chat',
          response: mockResponse,
          span,
        })
      ).rejects.toThrow('Test error');
    });
  });

  describe('_chatGenerator', () => {
    it('should call recordMetrics after span ends in generator', async () => {
      const mockArgs = [{ model: 'command-r-plus', message: 'test message' }];
      const mockResponse = async function* () {
        yield { eventType: 'stream', response: { response_id: '123' } };
        yield {
          eventType: 'stream-end',
          response: {
            response_id: '123',
            text: 'response text',
            finishReason: 'stop',
            meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } },
          },
        };
      }();
      const mockGenAIEndpoint = 'cohere.chat';

      jest.spyOn(CohereWrapper, '_chatCommonSetter').mockResolvedValue({
        genAIEndpoint: mockGenAIEndpoint,
        model: 'command-r-plus',
        user: 'test-user',
        cost: 0.5,
        aiSystem: 'cohere',
      });

      const generator = CohereWrapper._chatGenerator({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        response: mockResponse,
        span,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of generator) {
        // Consume generator without using the value
      }

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        genAIEndpoint: mockGenAIEndpoint,
        model: 'command-r-plus',
        user: 'test-user',
        cost: 0.5,
        aiSystem: 'cohere',
      });
    });
  });

  describe('_chatCommonSetter', () => {
    it('should set span attributes and return metric parameters', async () => {
      const mockArgs = [
        {
          model: 'command-r-plus',
          message: 'test message',
          max_tokens: 100,
          temperature: 0.7,
          p: 0.9,
          k: 5,
          frequency_penalty: 0.5,
          presence_penalty: 0.3,
          seed: 42,
          stop_sequences: ['END'],
        },
      ];
      const mockResult = {
        response_id: '123',
        meta: { billedUnits: { inputTokens: 10, outputTokens: 20 } },
        text: 'response text',
        finishReason: 'stop',
      };
      const mockGenAIEndpoint = 'cohere.chat';

      jest.restoreAllMocks();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      const metricParams = await CohereWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: mockGenAIEndpoint,
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_TOP_P,
        0.9
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_TOP_K,
        5
      );
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
        0.3
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY,
        0.5
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_SEED,
        42
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_IS_STREAM,
        false
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES,
        ['END']
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_MODEL,
        'command-r-plus'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        'text'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS,
        10
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS,
        20
      );
      expect(metricParams).toEqual({
        genAIEndpoint: mockGenAIEndpoint,
        model: 'command-r-plus',
        user: undefined,
        cost: 0.5,
        aiSystem: 'cohere',
      });
    });

    it('should handle tool calls properly', async () => {
      const mockArgs = [
        {
          model: 'command-r-plus',
          message: 'what is the weather?',
          tools: [{ type: 'function', function: { name: 'get_weather' } }],
        },
      ];
      const mockResult = {
        response_id: '456',
        meta: { billedUnits: { inputTokens: 15, outputTokens: 25 } },
        text: '',
        finishReason: 'tool_use',
        toolCalls: [
          {
            id: 'call_abc',
            name: 'get_weather',
            arguments: '{"location":"SF"}',
          },
        ],
      };

      jest.restoreAllMocks();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.3);

      await CohereWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'cohere.chat',
        result: mockResult,
        span,
      });

      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME,
        'get_weather'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_CALL_ID,
        'call_abc'
      );
      expect(span.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_ARGS,
        '{"location":"SF"}'
      );
    });

    it('should not set sentinel values for optional parameters', async () => {
      const mockArgs = [{ model: 'command-r-plus', message: 'test' }];
      const mockResult = {
        response_id: '789',
        meta: { billedUnits: { inputTokens: 5, outputTokens: 10 } },
        text: 'ok',
        finishReason: 'stop',
      };

      jest.restoreAllMocks();
      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      await CohereWrapper._chatCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'cohere.chat',
        result: mockResult,
        span,
      });

      const setAttrCalls = (span.setAttribute as jest.Mock).mock.calls;
      const attrKeys = setAttrCalls.map((call: any[]) => call[0]);

      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_SEED);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_PRESENCE_PENALTY);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_FREQUENCY_PENALTY);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_STOP_SEQUENCES);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_REQUEST_TOP_K);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS);
      expect(attrKeys).not.toContain(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE);
    });

    describe('error handling', () => {
      it('should not call recordMetrics and handle the error properly', async () => {
        const mockArgs = [{ model: 'command-r-plus', message: 'test', max_tokens: 100, temperature: 0.7 }];
        const mockGenAIEndpoint = 'cohere.chat';
        const mockError = new Error('Test error');

        jest.spyOn(CohereWrapper, '_chatCommonSetter').mockRejectedValue(mockError);

        await expect(
          CohereWrapper._chatCommonSetter({
            args: mockArgs,
            genAIEndpoint: mockGenAIEndpoint,
            result: {},
            span,
          })
        ).rejects.toThrow('Test error');

        expect(BaseWrapper.recordMetrics).not.toHaveBeenCalled();
      });
    });
  });
});
