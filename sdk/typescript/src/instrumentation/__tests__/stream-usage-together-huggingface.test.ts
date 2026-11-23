/**
 * Streaming usage: the provider's real usage on the final chunk must win over
 * the local token estimator in the Together and HuggingFace wrappers.
 */

import { trace } from '@opentelemetry/api';
import TogetherWrapper from '../together/wrapper';
import HuggingFaceWrapper from '../huggingface/wrapper';
import OpenlitConfig from '../../config';
import OpenLitHelper from '../../helpers';

jest.mock('../../config');
jest.mock('../../helpers');
jest.mock('../base-wrapper');

async function* chunks() {
  yield { id: 'c1', choices: [{ delta: { content: 'Hello' } }] };
  yield { id: 'c1', choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] };
  yield {
    id: 'c1',
    choices: [],
    usage: { prompt_tokens: 9, completion_tokens: 12, total_tokens: 21 },
  };
}

const cases: [string, any, string][] = [
  ['Together', TogetherWrapper, 'openaiTokens'],
  ['HuggingFace', HuggingFaceWrapper, 'generalTokens'],
];

describe.each(cases)('%s streaming usage', (_name, Wrapper, estimator) => {
  beforeEach(() => {
    jest.clearAllMocks();
    (OpenlitConfig as any).pricingInfo = {};
    (OpenlitConfig as any).captureMessageContent = true;
    // A local estimator that would disagree with the provider's numbers.
    (OpenLitHelper as any)[estimator] = jest.fn().mockReturnValue(100);
    jest.spyOn(OpenLitHelper, 'getChatModelCost').mockReturnValue(0.001);
  });

  it('reports the provider usage from the final chunk, not the estimate', async () => {
    const span = trace.getTracer('t').startSpan('s');
    const args = [{ model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true }];
    const gen = Wrapper._chatCompletionGenerator({
      args,
      genAIEndpoint: 'chat',
      response: chunks(),
      span,
    });
    for await (const _ of gen) {
      // drain
    }
    expect(OpenLitHelper.getChatModelCost).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      9,
      12
    );
  });
});
