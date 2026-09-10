import {
  InstrumentationBase,
  InstrumentationConfig,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  InstrumentationNodeModuleFile,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { diag } from '@opentelemetry/api';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import LettaWrapper from './wrapper';

export interface LettaInstrumentationConfig extends InstrumentationConfig {}

/**
 * Each Letta resource class lives in its own internal module file. `className`
 * is the export patched on that file; `methods` maps a JS method to the
 * Python-style endpoint id that drives the operation type and span name.
 *
 * The Python reference keys the operation type on the method suffix, so the JS
 * `update` methods map to `letta.modify` and `messages.create` maps to
 * `letta.create_message` (Python's own disambiguated chat endpoint) so both SDKs
 * emit identical telemetry for the same call.
 */
interface LettaModule {
  file: string;
  className: string;
  methods: Array<[string, string]>;
  agentScoped: boolean;
}

const AGENT_METHODS: Array<[string, string]> = [
  ['create', 'letta.create'],
  ['retrieve', 'letta.retrieve'],
  ['update', 'letta.modify'],
  ['delete', 'letta.delete'],
  ['list', 'letta.list'],
];

const MESSAGE_METHODS: Array<[string, string]> = [
  ['create', 'letta.create_message'],
  ['stream', 'letta.create_stream'],
  ['createAsync', 'letta.create_async'],
  ['list', 'letta.list'],
  ['cancel', 'letta.cancel'],
  ['reset', 'letta.reset'],
];

const MEMORY_METHODS: Array<[string, string]> = [
  ['create', 'letta.create'],
  ['retrieve', 'letta.retrieve'],
  ['update', 'letta.modify'],
  ['delete', 'letta.delete'],
  ['list', 'letta.list'],
];

const AGENT_BLOCK_METHODS: Array<[string, string]> = [
  ['retrieve', 'letta.retrieve'],
  ['update', 'letta.modify'],
  ['list', 'letta.list'],
  ['attach', 'letta.attach'],
  ['detach', 'letta.detach'],
];

const AGENT_ATTACH_METHODS: Array<[string, string]> = [
  ['list', 'letta.list'],
  ['attach', 'letta.attach'],
  ['detach', 'letta.detach'],
];

const PASSAGE_METHODS: Array<[string, string]> = [
  ['create', 'letta.create'],
  ['list', 'letta.list'],
  ['delete', 'letta.delete'],
];

const LETTA_MODULES: LettaModule[] = [
  { file: 'resources/agents/agents.js', className: 'Agents', methods: AGENT_METHODS, agentScoped: true },
  { file: 'resources/agents/messages.js', className: 'Messages', methods: MESSAGE_METHODS, agentScoped: true },
  { file: 'resources/blocks/blocks.js', className: 'Blocks', methods: MEMORY_METHODS, agentScoped: false },
  { file: 'resources/agents/blocks.js', className: 'Blocks', methods: AGENT_BLOCK_METHODS, agentScoped: true },
  { file: 'resources/tools.js', className: 'Tools', methods: MEMORY_METHODS, agentScoped: false },
  { file: 'resources/agents/tools.js', className: 'Tools', methods: AGENT_ATTACH_METHODS, agentScoped: true },
  { file: 'resources/folders/folders.js', className: 'Folders', methods: MEMORY_METHODS, agentScoped: false },
  { file: 'resources/agents/folders.js', className: 'Folders', methods: AGENT_ATTACH_METHODS, agentScoped: true },
  { file: 'resources/agents/passages.js', className: 'Passages', methods: PASSAGE_METHODS, agentScoped: true },
];

const PACKAGE = '@letta-ai/letta-client';
const VERSIONS = ['>=0.1.0'];

export default class OpenlitLettaInstrumentation extends InstrumentationBase {
  constructor(config: LettaInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-letta`, '1.0.0', config);
  }

  protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[] {
    // The Letta client exposes resource classes as nested objects (client.agents,
    // client.agents.messages, ...), each defined in its own internal module file.
    // require-in-the-middle reaches those files via the `files` array, so every
    // resource class is registered as an InstrumentationNodeModuleFile.
    const files = LETTA_MODULES.map(
      (mod) =>
        new InstrumentationNodeModuleFile(
          `${PACKAGE}/${mod.file}`,
          VERSIONS,
          (moduleExports: any, moduleVersion?: string) => {
            this._patchClass(moduleExports?.[mod.className], mod.methods, mod.agentScoped, moduleVersion);
            return moduleExports;
          },
          (moduleExports: any) => {
            if (moduleExports !== undefined) this._unpatchClass(moduleExports?.[mod.className], mod.methods);
          }
        )
    );

    const module = new InstrumentationNodeModuleDefinition(
      PACKAGE,
      VERSIONS,
      (moduleExports: any) => moduleExports,
      () => {},
      files
    );

    return [module];
  }

  public manualPatch(letta: any): void {
    // Fallback entry point. Best-effort: look each resource class up by name on the
    // object passed in; the isWrapped guard in _patchClass keeps repeat calls safe.
    for (const mod of LETTA_MODULES) {
      this._patchClass(letta?.[mod.className], mod.methods, mod.agentScoped);
    }
  }

  private _patchClass(
    target: any,
    methods: Array<[string, string]>,
    agentScoped: boolean,
    moduleVersion?: string
  ): void {
    try {
      const proto = target?.prototype;
      if (!proto) return;
      for (const [method, endpoint] of methods) {
        if (typeof proto[method] !== 'function') continue;
        if (isWrapped(proto[method])) continue;
        this._wrap(proto, method, LettaWrapper._patchOperation(this.tracer, endpoint, agentScoped, moduleVersion));
      }
    } catch (e) {
      diag.error('letta instrumentation: error in _patch method', e);
    }
  }

  private _unpatchClass(target: any, methods: Array<[string, string]>): void {
    try {
      const proto = target?.prototype;
      if (!proto) return;
      for (const [method] of methods) {
        if (typeof proto[method] === 'function' && isWrapped(proto[method])) {
          this._unwrap(proto, method);
        }
      }
    } catch {
      /* ignore */
    }
  }
}
