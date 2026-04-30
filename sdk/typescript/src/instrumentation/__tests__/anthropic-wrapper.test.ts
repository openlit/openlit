import { Span, trace } from '@opentelemetry/api';
import AnthropicWrapper from '../anthropic/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

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
      const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [{ role: 'user', content: 'test' }] }];
      const mockResponse = {
        id: 'msg_123',
        model: 'claude-3-5-sonnet-latest',
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      jest.spyOn(BaseWrapper, 'recordMetrics').mockImplementation(() => {});

      jest.spyOn(AnthropicWrapper, '_messageCreateCommonSetter').mockImplementationOnce(async ({ genAIEndpoint, span }) => {
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_ID, 'msg_123');
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
        span.setAttribute(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
        span.setAttribute(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
        span.setAttribute(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);

        return {
          genAIEndpoint,
          model: 'claude-3-5-sonnet-latest',
          user: undefined,
          cost: 0.5,
          aiSystem: 'anthropic',
        };
      });

      await AnthropicWrapper._messageCreate({
        args: mockArgs,
        genAIEndpoint: 'anthropic.resources.messages',
        response: mockResponse,
        span,
      });

      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(span, {
        model: 'claude-3-5-sonnet-latest',
        user: undefined,
        cost: 0.5,
        aiSystem: 'anthropic',
        genAIEndpoint: 'anthropic.resources.messages',
      });
    });

    it('should re-throw errors from commonSetter', async () => {
      const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [] }];
      const mockResponse = {};

      jest.spyOn(BaseWrapper, 'recordMetrics').mockImplementation(() => {});
      jest.spyOn(AnthropicWrapper, '_messageCreateCommonSetter').mockRejectedValueOnce(new Error('test error'));

      await expect(
        AnthropicWrapper._messageCreate({
          args: mockArgs,
          genAIEndpoint: 'anthropic.resources.messages',
          response: mockResponse,
          span,
        })
      ).rejects.toThrow('test error');
    });
  });

  describe('_messageCreateCommonSetter', () => {
    it('should set span attributes and return metric parameters', async () => {
      const mockArgs = [{
        model: 'claude-3-5-sonnet-latest',
        messages: [{ role: 'user', content: 'test message' }],
        max_tokens: 100,
        temperature: 0.7,
      }];
      const mockResult = {
        id: 'msg_123',
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello' }],
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);

      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      const metricParams = await AnthropicWrapper._messageCreateCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'anthropic.resources.messages',
        result: mockResult,
        span,
      });

      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_ID, 'msg_123');
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 100);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.7);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 10);
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 20);
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['stop']
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_MODEL,
        'claude-3-5-sonnet-20241022'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        'text'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_IS_STREAM, false);

      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_TOTAL_TOKENS,
        expect.anything()
      );

      expect(metricParams).toEqual({
        genAIEndpoint: 'anthropic.resources.messages',
        model: 'claude-3-5-sonnet-latest',
        user: undefined,
        cost: 0.5,
        aiSystem: 'anthropic',
      });
    });

    it('should map Anthropic finish reasons to OTel standard', async () => {
      const makeResult = (stop_reason: string) => ({
        id: 'msg_1',
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'claude-3-5-sonnet-latest',
        stop_reason,
        content: [{ type: 'text', text: 'hi' }],
      });

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);

      const testCases = [
        { anthropic: 'end_turn', otel: 'stop' },
        { anthropic: 'max_tokens', otel: 'length' },
        { anthropic: 'stop_sequence', otel: 'stop' },
        { anthropic: 'tool_use', otel: 'tool_call' },
      ];

      for (const { anthropic, otel } of testCases) {
        jest.clearAllMocks();
        span.setAttribute = jest.fn();

        await AnthropicWrapper._messageCreateCommonSetter({
          args: [{ model: 'claude-3-5-sonnet-latest', messages: [] }],
          genAIEndpoint: 'anthropic.resources.messages',
          result: makeResult(anthropic),
          span,
        });

        expect(span.setAttribute).toHaveBeenCalledWith(
          SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
          [otel]
        );
      }
    });

    it('should not set max_tokens when not provided', async () => {
      const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [], temperature: 1 }];
      const mockResult = {
        id: 'msg_1',
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'claude-3-5-sonnet-latest',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'hi' }],
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      await AnthropicWrapper._messageCreateCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'anthropic.resources.messages',
        result: mockResult,
        span,
      });

      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS,
        expect.anything()
      );
    });

    it('should not set seed when not provided', async () => {
      const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [] }];
      const mockResult = {
        id: 'msg_1',
        usage: { input_tokens: 5, output_tokens: 5 },
        model: 'claude-3-5-sonnet-latest',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'hi' }],
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      await AnthropicWrapper._messageCreateCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'anthropic.resources.messages',
        result: mockResult,
        span,
      });

      expect(setAttributeSpy).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_REQUEST_SEED,
        expect.anything()
      );
    });

    it('should emit inference event when events are enabled', async () => {
      const mockArgs = [{
        model: 'claude-3-5-sonnet-latest',
        messages: [{ role: 'user', content: 'hello' }],
      }];
      const mockResult = {
        id: 'msg_123',
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'claude-3-5-sonnet-latest',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hi there' }],
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = false;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.5);
      const emitSpy = jest.spyOn(OpenLitHelper, 'emitInferenceEvent').mockImplementation(() => {});

      await AnthropicWrapper._messageCreateCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'anthropic.resources.messages',
        result: mockResult,
        span,
      });

      expect(emitSpy).toHaveBeenCalledWith(span, expect.objectContaining({
        [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
        [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'claude-3-5-sonnet-latest',
        [SemanticConvention.GEN_AI_RESPONSE_MODEL]: 'claude-3-5-sonnet-latest',
        [SemanticConvention.SERVER_ADDRESS]: 'api.anthropic.com',
        [SemanticConvention.SERVER_PORT]: 443,
        [SemanticConvention.GEN_AI_RESPONSE_ID]: 'msg_123',
        [SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON]: ['stop'],
        [SemanticConvention.GEN_AI_OUTPUT_TYPE]: 'text',
        [SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS]: 10,
        [SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS]: 20,
      }));
    });

    it('should set tool call attributes when tool_use blocks are present', async () => {
      const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [] }];
      const mockResult = {
        id: 'msg_1',
        usage: { input_tokens: 10, output_tokens: 20 },
        model: 'claude-3-5-sonnet-latest',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: '' },
          { type: 'tool_use', id: 'toolu_123', name: 'get_weather', input: { location: 'Paris' } },
        ],
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      await AnthropicWrapper._messageCreateCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'anthropic.resources.messages',
        result: mockResult,
        span,
      });

      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        'json'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_NAME,
        'get_weather'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_TOOL_CALL_ID,
        'toolu_123'
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        ['tool_call']
      );
    });

    it('should set cache token attributes when present', async () => {
      const mockArgs = [{ model: 'claude-3-5-sonnet-latest', messages: [] }];
      const mockResult = {
        id: 'msg_1',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 3,
        },
        model: 'claude-3-5-sonnet-latest',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'cached response' }],
      };

      (OpenlitConfig as any).pricingInfo = {};
      (OpenlitConfig as any).disableEvents = true;
      jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0);
      const setAttributeSpy = jest.spyOn(span, 'setAttribute');

      await AnthropicWrapper._messageCreateCommonSetter({
        args: mockArgs,
        genAIEndpoint: 'anthropic.resources.messages',
        result: mockResult,
        span,
      });

      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
        5
      );
      expect(setAttributeSpy).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
        3
      );
    });
  });
});
