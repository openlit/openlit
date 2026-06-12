import { diag, Tracer } from '@opentelemetry/api';
import {
  InstrumentationBase,
  InstrumentationModuleDefinition,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
import { INSTRUMENTATION_PREFIX } from '../../constant';
import {
  patchCallTool,
  patchClientConnect,
  patchClientClose,
  patchGetPrompt,
  patchListPrompts,
  patchListResources,
  patchListTools,
  patchMcpServerConnect,
  patchReadResource,
  patchServerConnect,
  patchTransportSend,
  patchTransportStart,
} from './wrapper';

export interface MCPInstrumentationConfig extends InstrumentationConfig {}

/** MCP SDK subpaths — match ESM/CJS resolution (see Traceloop instrumentation-mcp). */
const CLIENT_MODULES = [
  '@modelcontextprotocol/sdk/client',
  '@modelcontextprotocol/sdk/client/index.js',
] as const;

const SERVER_MODULES = [
  '@modelcontextprotocol/sdk/server',
  '@modelcontextprotocol/sdk/server/index.js',
] as const;

const MCP_SERVER_MODULES = [
  '@modelcontextprotocol/sdk/server/mcp',
  '@modelcontextprotocol/sdk/server/mcp.js',
] as const;

/**
 * Transport subpaths. Patching their `send`/`start` injects and extracts W3C
 * trace context via the JSON-RPC `params._meta` field, linking client and
 * server traces across the MCP boundary (same approach as openinference).
 */
const TRANSPORT_MODULES = [
  '@modelcontextprotocol/sdk/inMemory',
  '@modelcontextprotocol/sdk/inMemory.js',
  '@modelcontextprotocol/sdk/client/stdio',
  '@modelcontextprotocol/sdk/client/stdio.js',
  '@modelcontextprotocol/sdk/server/stdio',
  '@modelcontextprotocol/sdk/server/stdio.js',
  '@modelcontextprotocol/sdk/client/sse',
  '@modelcontextprotocol/sdk/client/sse.js',
  '@modelcontextprotocol/sdk/server/sse',
  '@modelcontextprotocol/sdk/server/sse.js',
  '@modelcontextprotocol/sdk/client/streamableHttp',
  '@modelcontextprotocol/sdk/client/streamableHttp.js',
  '@modelcontextprotocol/sdk/server/streamableHttp',
  '@modelcontextprotocol/sdk/server/streamableHttp.js',
  '@modelcontextprotocol/sdk/client/websocket',
  '@modelcontextprotocol/sdk/client/websocket.js',
] as const;

const TRANSPORT_METHODS = ['send', 'start'] as const;

const CLIENT_METHODS = [
  'callTool',
  'listTools',
  'getPrompt',
  'listPrompts',
  'readResource',
  'listResources',
  'connect',
  'close',
] as const;

const CLIENT_PATCHERS: Record<string, (tracer: Tracer, version: string) => unknown> = {
  callTool: patchCallTool,
  listTools: patchListTools,
  getPrompt: patchGetPrompt,
  listPrompts: patchListPrompts,
  readResource: patchReadResource,
  listResources: patchListResources,
  connect: patchClientConnect,
  close: patchClientClose,
};

export default class MCPInstrumentation extends InstrumentationBase {
  private _mcpVersion = 'unknown';

  constructor(config: MCPInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-mcp`, '1.0.0', config);
  }

  protected init():
    | void
    | InstrumentationModuleDefinition
    | InstrumentationModuleDefinition[] {
    const modules: InstrumentationNodeModuleDefinition[] = [];

    for (const name of CLIENT_MODULES) {
      modules.push(
        new InstrumentationNodeModuleDefinition(
          name,
          ['>=1.0.0'],
          (moduleExports, moduleVersion) => {
            if (moduleVersion) this._mcpVersion = String(moduleVersion);
            this.patchClientModule(moduleExports);
            return moduleExports;
          },
          (moduleExports) => {
            if (moduleExports !== undefined) {
              this.unpatchClientModule(moduleExports);
            }
          },
        ),
      );
    }

    for (const name of SERVER_MODULES) {
      modules.push(
        new InstrumentationNodeModuleDefinition(
          name,
          ['>=1.0.0'],
          (moduleExports, moduleVersion) => {
            if (moduleVersion) this._mcpVersion = String(moduleVersion);
            this.patchServerModule(moduleExports);
            return moduleExports;
          },
          (moduleExports) => {
            if (moduleExports !== undefined) {
              this.unpatchServerModule(moduleExports);
            }
          },
        ),
      );
    }

    for (const name of MCP_SERVER_MODULES) {
      modules.push(
        new InstrumentationNodeModuleDefinition(
          name,
          ['>=1.0.0'],
          (moduleExports, moduleVersion) => {
            if (moduleVersion) this._mcpVersion = String(moduleVersion);
            this.patchMcpServerModule(moduleExports);
            return moduleExports;
          },
          (moduleExports) => {
            if (moduleExports !== undefined) {
              this.unpatchMcpServerModule(moduleExports);
            }
          },
        ),
      );
    }

    for (const name of TRANSPORT_MODULES) {
      modules.push(
        new InstrumentationNodeModuleDefinition(
          name,
          ['>=1.0.0'],
          (moduleExports, moduleVersion) => {
            if (moduleVersion) this._mcpVersion = String(moduleVersion);
            this.patchTransportModule(moduleExports);
            return moduleExports;
          },
          (moduleExports) => {
            if (moduleExports !== undefined) {
              this.unpatchTransportModule(moduleExports);
            }
          },
        ),
      );
    }

    return modules;
  }

  /**
   * Manually instrument MCP SDK modules when auto-instrumentation does not apply
   * (bundlers, ESM edge cases). Pass the same module namespace the app imports, e.g.
   * `import * as client from '@modelcontextprotocol/sdk/client/index.js'`.
   */
  public manualPatch(moduleExports: any): void {
    if (!moduleExports) return;
    try {
      if (moduleExports.Client) {
        this.patchClientModule(moduleExports);
      }
      if (moduleExports.Server) {
        this.patchServerModule(moduleExports);
      }
      if (moduleExports.McpServer) {
        this.patchMcpServerModule(moduleExports);
      }
      if (this.hasTransportExport(moduleExports)) {
        this.patchTransportModule(moduleExports);
      }
    } catch (e) {
      diag.error('Error in MCP manualPatch', e as Error);
    }
  }

  private hasTransportExport(moduleExports: any): boolean {
    return Object.keys(moduleExports || {}).some(
      (key) => key.endsWith('Transport') && moduleExports[key]?.prototype,
    );
  }

  /**
   * Patch every `*Transport` class exported by a transport module. We discover
   * them by name rather than hard-coding each class so new transports are
   * covered automatically.
   */
  private patchTransportModule(moduleExports: any): void {
    if (!moduleExports) return;
    for (const key of Object.keys(moduleExports)) {
      if (!key.endsWith('Transport')) continue;
      const transportClass = moduleExports[key];
      if (!transportClass?.prototype) continue;

      for (const method of TRANSPORT_METHODS) {
        if (typeof transportClass.prototype[method] !== 'function') continue;
        if (isWrapped(transportClass.prototype[method])) {
          this._unwrap(transportClass.prototype, method);
        }
        const patcher = method === 'send' ? patchTransportSend : patchTransportStart;
        this._wrap(
          transportClass.prototype,
          method,
          patcher() as (original: (...args: any[]) => any) => any,
        );
      }
    }
  }

  private unpatchTransportModule(moduleExports: any): void {
    if (!moduleExports) return;
    for (const key of Object.keys(moduleExports)) {
      if (!key.endsWith('Transport')) continue;
      const transportClass = moduleExports[key];
      if (!transportClass?.prototype) continue;
      for (const method of TRANSPORT_METHODS) {
        if (isWrapped(transportClass.prototype[method])) {
          this._unwrap(transportClass.prototype, method);
        }
      }
    }
  }

  private patchClientModule(moduleExports: any): void {
    const Client = moduleExports?.Client;
    if (!Client?.prototype) return;

    for (const method of CLIENT_METHODS) {
      const patcherFactory = CLIENT_PATCHERS[method];
      if (typeof Client.prototype[method] !== 'function' || !patcherFactory) continue;

      if (isWrapped(Client.prototype[method])) {
        this._unwrap(Client.prototype, method);
      }
      this._wrap(
        Client.prototype,
        method,
        patcherFactory(this.tracer, this._mcpVersion) as (original: (...args: any[]) => any) => any,
      );
    }
  }

  private unpatchClientModule(moduleExports: any): void {
    const Client = moduleExports?.Client;
    if (!Client?.prototype) return;

    for (const method of CLIENT_METHODS) {
      if (isWrapped(Client.prototype[method])) {
        this._unwrap(Client.prototype, method);
      }
    }
  }

  private patchServerModule(moduleExports: any): void {
    const Server = moduleExports?.Server;
    if (!Server?.prototype) return;

    for (const method of ['connect', 'close'] as const) {
      if (typeof Server.prototype[method] !== 'function') continue;
      const patcher = method === 'connect' ? patchServerConnect : patchClientClose;
      if (isWrapped(Server.prototype[method])) {
        this._unwrap(Server.prototype, method);
      }
      this._wrap(
        Server.prototype,
        method,
        patcher(this.tracer, this._mcpVersion) as (original: (...args: any[]) => any) => any,
      );
    }
  }

  private unpatchServerModule(moduleExports: any): void {
    const Server = moduleExports?.Server;
    if (!Server?.prototype) return;

    for (const method of ['connect', 'close'] as const) {
      if (isWrapped(Server.prototype[method])) {
        this._unwrap(Server.prototype, method);
      }
    }
  }

  private patchMcpServerModule(moduleExports: any): void {
    const McpServer = moduleExports?.McpServer;
    if (!McpServer?.prototype) return;

    if (typeof McpServer.prototype.connect === 'function') {
      if (isWrapped(McpServer.prototype.connect)) {
        this._unwrap(McpServer.prototype, 'connect');
      }
      this._wrap(
        McpServer.prototype,
        'connect',
        patchMcpServerConnect(this.tracer, this._mcpVersion) as (original: (...args: any[]) => any) => any,
      );
    }

    if (typeof McpServer.prototype.close === 'function') {
      if (isWrapped(McpServer.prototype.close)) {
        this._unwrap(McpServer.prototype, 'close');
      }
      this._wrap(
        McpServer.prototype,
        'close',
        patchClientClose(this.tracer, this._mcpVersion) as (original: (...args: any[]) => any) => any,
      );
    }
  }

  private unpatchMcpServerModule(moduleExports: any): void {
    const McpServer = moduleExports?.McpServer;
    if (!McpServer?.prototype) return;

    for (const method of ['connect', 'close'] as const) {
      if (isWrapped(McpServer.prototype[method])) {
        this._unwrap(McpServer.prototype, method);
      }
    }
  }
}
