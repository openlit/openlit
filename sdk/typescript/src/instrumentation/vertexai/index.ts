import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import VertexAIWrapper from './wrapper';

export interface VertexAIInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitVertexAIInstrumentation extends InstrumentationBase {
  constructor(config: VertexAIInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-vertexai`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@google-cloud/vertexai',
      ['>=0.1.0'],
      (moduleExports) => {
        this._patch(moduleExports);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports !== undefined) {
          this._unpatch(moduleExports);
        }
      }
    );
    return [module];
  }

  public manualPatch(vertexAI: any): void {
    this._patch(vertexAI);
  }

  protected _patch(moduleExports: any) {
    try {
      const GenerativeModel =
        moduleExports.GenerativeModel || moduleExports.GenerativeModelPreview;
      const ChatSession =
        moduleExports.ChatSession || moduleExports.ChatSessionPreview;

      if (GenerativeModel) {
        if (isWrapped(GenerativeModel.prototype.generateContent)) {
          this._unwrap(GenerativeModel.prototype, 'generateContent');
        }
        if (isWrapped(GenerativeModel.prototype.generateContentStream)) {
          this._unwrap(GenerativeModel.prototype, 'generateContentStream');
        }
        this._wrap(
          GenerativeModel.prototype,
          'generateContent',
          VertexAIWrapper._patchGenerateContent(this.tracer)
        );
        this._wrap(
          GenerativeModel.prototype,
          'generateContentStream',
          VertexAIWrapper._patchGenerateContentStream(this.tracer)
        );
      }

      if (ChatSession) {
        if (isWrapped(ChatSession.prototype.sendMessage)) {
          this._unwrap(ChatSession.prototype, 'sendMessage');
        }
        if (isWrapped(ChatSession.prototype.sendMessageStream)) {
          this._unwrap(ChatSession.prototype, 'sendMessageStream');
        }
        this._wrap(
          ChatSession.prototype,
          'sendMessage',
          VertexAIWrapper._patchSendMessage(this.tracer)
        );
        this._wrap(
          ChatSession.prototype,
          'sendMessageStream',
          VertexAIWrapper._patchSendMessageStream(this.tracer)
        );
      }
    } catch (e) {
      console.error('Error in _patch method:', e);
    }
  }

  protected _unpatch(moduleExports: any) {
    const GenerativeModel =
      moduleExports.GenerativeModel || moduleExports.GenerativeModelPreview;
    const ChatSession =
      moduleExports.ChatSession || moduleExports.ChatSessionPreview;
    if (GenerativeModel) {
      this._unwrap(GenerativeModel.prototype, 'generateContent');
      this._unwrap(GenerativeModel.prototype, 'generateContentStream');
    }
    if (ChatSession) {
      this._unwrap(ChatSession.prototype, 'sendMessage');
      this._unwrap(ChatSession.prototype, 'sendMessageStream');
    }
  }
}
