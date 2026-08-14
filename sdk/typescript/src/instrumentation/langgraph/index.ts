import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import LangGraphWrapper from './wrapper';

export interface LangGraphInstrumentationConfig extends InstrumentationConfig {}

export default class OpenlitLangGraphInstrumentation extends InstrumentationBase {
  constructor(config: LangGraphInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-langgraph`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@langchain/langgraph',
      ['>=0.0.31'],
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

  public manualPatch(langgraph: any): void {
    this._patch(langgraph);
  }

  protected _patch(moduleExports: any) {
    try {
      const StateGraph = moduleExports.StateGraph;
      if (StateGraph?.prototype) {
        if (StateGraph.prototype.compile) {
          if (isWrapped(StateGraph.prototype.compile)) {
            this._unwrap(StateGraph.prototype, 'compile');
          }
          this._wrap(
            StateGraph.prototype,
            'compile',
            LangGraphWrapper._patchCompile(this.tracer)
          );
        }

        if (StateGraph.prototype.addNode) {
          if (isWrapped(StateGraph.prototype.addNode)) {
            this._unwrap(StateGraph.prototype, 'addNode');
          }
          this._wrap(
            StateGraph.prototype,
            'addNode',
            LangGraphWrapper._patchAddNode(this.tracer)
          );
        }
      }

      // Pregel is the compiled graph runtime — patch invoke and stream.
      // It may be exported directly or available on CompiledStateGraph.
      const Pregel = moduleExports.Pregel;
      if (Pregel?.prototype) {
        this._patchPregelProto(Pregel.prototype);
      }

      const CompiledStateGraph = moduleExports.CompiledStateGraph;
      if (CompiledStateGraph?.prototype) {
        this._patchPregelProto(CompiledStateGraph.prototype);
      }
    } catch { /* graceful degradation */ }
  }

  private _patchPregelProto(proto: any): void {
    if (proto.invoke) {
      if (isWrapped(proto.invoke)) {
        this._unwrap(proto, 'invoke');
      }
      this._wrap(proto, 'invoke', LangGraphWrapper._patchInvoke(this.tracer));
    }

    if (proto.stream) {
      if (isWrapped(proto.stream)) {
        this._unwrap(proto, 'stream');
      }
      this._wrap(proto, 'stream', LangGraphWrapper._patchStream(this.tracer));
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const StateGraph = moduleExports.StateGraph;
      if (StateGraph?.prototype) {
        if (isWrapped(StateGraph.prototype.compile)) this._unwrap(StateGraph.prototype, 'compile');
        if (isWrapped(StateGraph.prototype.addNode)) this._unwrap(StateGraph.prototype, 'addNode');
      }
      const Pregel = moduleExports.Pregel;
      if (Pregel?.prototype) {
        if (isWrapped(Pregel.prototype.invoke)) this._unwrap(Pregel.prototype, 'invoke');
        if (isWrapped(Pregel.prototype.stream)) this._unwrap(Pregel.prototype, 'stream');
      }
      const CompiledStateGraph = moduleExports.CompiledStateGraph;
      if (CompiledStateGraph?.prototype) {
        if (isWrapped(CompiledStateGraph.prototype.invoke)) this._unwrap(CompiledStateGraph.prototype, 'invoke');
        if (isWrapped(CompiledStateGraph.prototype.stream)) this._unwrap(CompiledStateGraph.prototype, 'stream');
      }
    } catch { /* ignore */ }
  }
}
