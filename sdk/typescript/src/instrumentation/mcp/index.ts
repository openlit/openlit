import { diag } from '@opentelemetry/api';
import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import MCPWrapper from './wrapper';

export interface MCPInstrumentationConfig extends InstrumentationConfig {}

export default class MCPInstrumentation extends InstrumentationBase {
  constructor(config: MCPInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-mcp`, '1.0.0', config);
  }

  protected init():
    | void
    | InstrumentationModuleDefinition
    | InstrumentationModuleDefinition[] {
    const module = new InstrumentationNodeModuleDefinition(
      '@modelcontextprotocol/sdk',
      ['>=1.0.0'],
      (moduleExports) => {
        this._patch(moduleExports);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports !== undefined) {
          this._unpatch(moduleExports);
        }
      },
    );
    return [module];
  }

  public manualPatch(mcpSdk: any): void {
    this._patch(mcpSdk);
  }

  protected _patch(moduleExports: any) {
    try {
      const Client = moduleExports.Client;
      if (!Client?.prototype) return;

      if (typeof Client.prototype.callTool === 'function') {
        if (isWrapped(Client.prototype.callTool)) {
          this._unwrap(Client.prototype, 'callTool');
        }
        this._wrap(
          Client.prototype,
          'callTool',
          MCPWrapper._patchCallTool(this.tracer),
        );
      }

      if (typeof Client.prototype.listTools === 'function') {
        if (isWrapped(Client.prototype.listTools)) {
          this._unwrap(Client.prototype, 'listTools');
        }
        this._wrap(
          Client.prototype,
          'listTools',
          MCPWrapper._patchListTools(this.tracer),
        );
      }

      if (typeof Client.prototype.getPrompt === 'function') {
        if (isWrapped(Client.prototype.getPrompt)) {
          this._unwrap(Client.prototype, 'getPrompt');
        }
        this._wrap(
          Client.prototype,
          'getPrompt',
          MCPWrapper._patchGetPrompt(this.tracer),
        );
      }

      if (typeof Client.prototype.listPrompts === 'function') {
        if (isWrapped(Client.prototype.listPrompts)) {
          this._unwrap(Client.prototype, 'listPrompts');
        }
        this._wrap(
          Client.prototype,
          'listPrompts',
          MCPWrapper._patchListPrompts(this.tracer),
        );
      }

      if (typeof Client.prototype.readResource === 'function') {
        if (isWrapped(Client.prototype.readResource)) {
          this._unwrap(Client.prototype, 'readResource');
        }
        this._wrap(
          Client.prototype,
          'readResource',
          MCPWrapper._patchReadResource(this.tracer),
        );
      }

      if (typeof Client.prototype.listResources === 'function') {
        if (isWrapped(Client.prototype.listResources)) {
          this._unwrap(Client.prototype, 'listResources');
        }
        this._wrap(
          Client.prototype,
          'listResources',
          MCPWrapper._patchListResources(this.tracer),
        );
      }
    } catch (e) {
      diag.error('Error in MCP _patch method', e as Error);
    }
  }

  protected _unpatch(moduleExports: any) {
    try {
      const Client = moduleExports.Client;
      if (!Client?.prototype) return;
      for (const method of [
        'callTool',
        'listTools',
        'getPrompt',
        'listPrompts',
        'readResource',
        'listResources',
      ]) {
        if (typeof Client.prototype[method] === 'function') {
          this._unwrap(Client.prototype, method);
        }
      }
    } catch {
      /* ignore */
    }
  }
}
