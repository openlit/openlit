/**
 * Cross-Language Trace Comparison Tests for local HuggingFace inference
 * (Transformers.js) instrumentation.
 *
 * Verifies that the TypeScript SDK produces traces consistent with the Python
 * `transformers` instrumentation and the OTel GenAI semantic conventions:
 *   - text-generation reports the `chat` operation (Python parity)
 *   - other local pipelines map to the closest OTel operation
 *   - token usage, cache tokens, timing, and package version are stamped
 */

import TransformersWrapper from '../transformers/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';
import BaseWrapper from '../base-wrapper';
import SemanticConvention from '../../semantic-convention';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

describe('Transformers.js Cross-Language Trace Comparison', () => {
  let mockSpan: any;
  let mockTracer: any;

  const makeInstance = (task: string, model = 'Xenova/distilgpt2') => ({
    task,
    model: { config: { _name_or_path: model } },
  });

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      addEvent: jest.fn(),
      end: jest.fn(),
      setStatus: jest.fn(),
    };

    mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
    };

    (OpenlitConfig as any).environment = 'openlit-testing';
    (OpenlitConfig as any).applicationName = 'openlit-test';
    (OpenlitConfig as any).captureMessageContent = true;
    (OpenlitConfig as any).pricingInfo = {};
    (OpenlitConfig as any).disableEvents = false;

    (OpenLitHelper as any).getChatModelCost = jest.fn().mockReturnValue(0.0);
    (OpenLitHelper as any).generalTokens = jest.fn().mockReturnValue(7);
    (OpenLitHelper as any).buildInputMessages = jest.fn().mockReturnValue('[{"role":"user"}]');
    (OpenLitHelper as any).buildOutputMessages = jest.fn().mockReturnValue('[{"role":"assistant"}]');
    (OpenLitHelper as any).handleException = jest.fn();
    (OpenLitHelper as any).emitInferenceEvent = jest.fn();
    (OpenLitHelper as any).computeAgentVersionHash = jest.fn().mockReturnValue('');

    (BaseWrapper as any).recordMetrics = jest.fn();
    (BaseWrapper as any).setBaseSpanAttributes = jest.fn().mockImplementation((span: any, attrs: any) => {
      span.setAttribute(SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL, attrs.aiSystem);
      span.setAttribute(SemanticConvention.GEN_AI_REQUEST_MODEL, attrs.model);
      if (attrs.cost !== undefined) span.setAttribute(SemanticConvention.GEN_AI_USAGE_COST, attrs.cost);
      // setBaseSpanAttributes stamps OpenLIT's SDK version; the wrapper must
      // override it with the transformers package version afterwards.
      span.setAttribute(SemanticConvention.GEN_AI_SDK_VERSION, 'openlit-sdk-version');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Span creation ──────────────────────────────────────────────────────────

  describe('Span creation', () => {
    it('creates a "chat {model}" span for text-generation (Python parity)', async () => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'TextGenerationPipeline', '3.0.0');
      const original = jest.fn().mockResolvedValue([{ generated_text: 'hello world' }]);
      const wrapped = patched(original);

      await wrapped.call(makeInstance('text-generation'), 'say hi', { temperature: 0.7 });

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'chat Xenova/distilgpt2',
        expect.objectContaining({
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
            [SemanticConvention.GEN_AI_PROVIDER_NAME_OTEL]: SemanticConvention.GEN_AI_SYSTEM_HUGGING_FACE,
            [SemanticConvention.SERVER_ADDRESS]: '127.0.0.1',
            [SemanticConvention.SERVER_PORT]: 80,
          }),
        }),
        expect.anything()
      );
    });

    it('maps summarization to the text_completion operation', async () => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'SummarizationPipeline');
      const original = jest.fn().mockResolvedValue([{ summary_text: 'short' }]);
      const wrapped = patched(original);

      await wrapped.call(makeInstance('summarization'), 'a long text', {});

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'text_completion Xenova/distilgpt2',
        expect.objectContaining({
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_TEXT_COMPLETION,
          }),
        }),
        expect.anything()
      );
    });

    it('maps feature-extraction to the embeddings operation', async () => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'FeatureExtractionPipeline');
      const original = jest.fn().mockResolvedValue({ data: [0.1, 0.2] });
      const wrapped = patched(original);

      await wrapped.call(makeInstance('feature-extraction'), 'embed me', {});

      expect(mockTracer.startSpan).toHaveBeenCalledWith(
        'embeddings Xenova/distilgpt2',
        expect.objectContaining({
          attributes: expect.objectContaining({
            [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_EMBEDDING,
          }),
        }),
        expect.anything()
      );
    });
  });

  // ── Attribute parity ─────────────────────────────────────────────────────────

  describe('Span attributes (Python parity)', () => {
    const callTextGen = async (sdkVersion?: string) => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'TextGenerationPipeline', sdkVersion);
      const original = jest.fn().mockResolvedValue([{ generated_text: 'the answer is 42' }]);
      const wrapped = patched(original);
      await wrapped.call(makeInstance('text-generation'), 'question', {
        temperature: 0.5,
        top_k: 40,
        top_p: 0.9,
        max_new_tokens: 64,
      });
    };

    it('stamps token usage including client.token.usage and cache tokens (0)', async () => {
      await callTextGen();

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_INPUT_TOKENS, 7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 7);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_CLIENT_TOKEN_USAGE, 14);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS, 0);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS, 0);
    });

    it('always stamps TTFT and TBT', async () => {
      await callTextGen();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SERVER_TTFT, expect.any(Number));
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_SERVER_TBT, 0);
    });

    it('stamps gen_ai.system and request params', async () => {
      await callTextGen();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_PROVIDER_NAME, 'huggingface');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TEMPERATURE, 0.5);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_K, 40);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_TOP_P, 0.9);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_REQUEST_MAX_TOKENS, 64);
    });

    it('overrides gen_ai.sdk.version with the transformers package version', async () => {
      await callTextGen('3.2.1');
      // The last write to GEN_AI_SDK_VERSION must be the package version, not OpenLIT's.
      const versionCalls = mockSpan.setAttribute.mock.calls.filter(
        (c: any[]) => c[0] === SemanticConvention.GEN_AI_SDK_VERSION
      );
      expect(versionCalls[versionCalls.length - 1][1]).toBe('3.2.1');
    });

    it('sets text output type and finish reason for generative tasks', async () => {
      await callTextGen();
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_TYPE,
        SemanticConvention.GEN_AI_OUTPUT_TYPE_TEXT
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON, ['stop']);
    });
  });

  describe('Embedding tasks', () => {
    it('does not set output messages or finish reason and reports 0 output tokens', async () => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'FeatureExtractionPipeline');
      const original = jest.fn().mockResolvedValue({ data: [0.1, 0.2, 0.3] });
      const wrapped = patched(original);

      await wrapped.call(makeInstance('feature-extraction'), 'embed me', {});

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(SemanticConvention.GEN_AI_USAGE_OUTPUT_TOKENS, 0);
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_RESPONSE_FINISH_REASON,
        expect.anything()
      );
      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_OUTPUT_MESSAGES,
        expect.anything()
      );
    });
  });

  // ── Content capture & events ─────────────────────────────────────────────────

  describe('Content capture and events', () => {
    it('captures input/output messages only when enabled', async () => {
      (OpenlitConfig as any).captureMessageContent = false;
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'TextGenerationPipeline');
      const original = jest.fn().mockResolvedValue([{ generated_text: 'hi' }]);
      await patched(original).call(makeInstance('text-generation'), 'in', {});

      expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
        SemanticConvention.GEN_AI_INPUT_MESSAGES,
        expect.anything()
      );
    });

    it('emits an inference event when events are enabled', async () => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'TextGenerationPipeline');
      const original = jest.fn().mockResolvedValue([{ generated_text: 'hi' }]);
      await patched(original).call(makeInstance('text-generation'), 'in', {});

      expect(OpenLitHelper.emitInferenceEvent).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({
          [SemanticConvention.GEN_AI_OPERATION]: SemanticConvention.GEN_AI_OPERATION_TYPE_CHAT,
          [SemanticConvention.GEN_AI_REQUEST_MODEL]: 'Xenova/distilgpt2',
        })
      );
    });
  });

  // ── Error path ───────────────────────────────────────────────────────────────

  describe('Error handling', () => {
    it('records error metrics once, ends the span, and rethrows', async () => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'TextGenerationPipeline');
      const err = new Error('inference failed');
      const original = jest.fn().mockRejectedValue(err);
      const wrapped = patched(original);

      await expect(wrapped.call(makeInstance('text-generation'), 'in', {})).rejects.toThrow('inference failed');

      expect(OpenLitHelper.handleException).toHaveBeenCalledWith(mockSpan, err);
      expect(BaseWrapper.recordMetrics).toHaveBeenCalledTimes(1);
      expect(BaseWrapper.recordMetrics).toHaveBeenCalledWith(
        mockSpan,
        expect.objectContaining({ errorType: 'Error' })
      );
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  // ── Response parsing per task ─────────────────────────────────────────────────

  describe('Response parsing', () => {
    it('extracts nested chat-message generated_text (text-generation)', async () => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'TextGenerationPipeline');
      const original = jest.fn().mockResolvedValue([
        { generated_text: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello there' }] },
      ]);
      await patched(original).call(makeInstance('text-generation'), 'hi', {});

      expect(OpenLitHelper.buildOutputMessages).toHaveBeenCalledWith('hello there', 'stop');
    });

    it('extracts translation_text (translation)', async () => {
      const patched = TransformersWrapper._patchPipelineCall(mockTracer, 'TranslationPipeline');
      const original = jest.fn().mockResolvedValue([{ translation_text: 'bonjour' }]);
      await patched(original).call(makeInstance('translation'), 'hello', {});

      expect(OpenLitHelper.buildOutputMessages).toHaveBeenCalledWith('bonjour', 'stop');
    });
  });
});
