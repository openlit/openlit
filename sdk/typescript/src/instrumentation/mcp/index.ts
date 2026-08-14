import { diag } from '@opentelemetry/api';
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
  patchListTools,
  patchGetPrompt,
  patchListPrompts,
  patchReadResource,
  patchListResources,
  patchClientSessionSendRequest,
  patchClientSessionInitialize,
  patchServerRun,
  patchServerCallTool,
  patchServerListTools,
  patchServerReadResource,
  patchServerListResources,
  patchTransport,
  patchServerSessionOperation,
} from './wrapper';

export interface MCPInstrumentationConfig extends InstrumentationConfig {}

export default class MCPInstrumentation extends InstrumentationBase {
  private _mcpVersion = 'unknown';

  constructor(config: MCPInstrumentationConfig = {}) {
    super(`${INSTRUMENTATION_PREFIX}/instrumentation-mcp`, '1.0.0', config);
  }

  protected init():
    | void
    | InstrumentationModuleDefinition
    | InstrumentationModuleDefinition[] {
    // Main MCP SDK module — covers Client, Server, and FastMCP
    const mainModule = new InstrumentationNodeModuleDefinition(
      '@modelcontextprotocol/sdk',
      ['>=1.0.0'],
      (moduleExports, moduleVersion) => {
        if (moduleVersion) this._mcpVersion = String(moduleVersion);
        this._patchMain(moduleExports);
        return moduleExports;
      },
      (moduleExports) => {
        if (moduleExports !== undefined) {
          this._unpatchMain(moduleExports);
        }
      },
    );

    return [mainModule];
  }

  public manualPatch(mcpSdk: any): void {
    this._patchMain(mcpSdk);
  }

  // -----------------------------------------------------------------------
  // Main module patching — Client, Server, FastMCP, and transport classes
  // -----------------------------------------------------------------------

  private _patchMain(moduleExports: any): void {
    try {
      this._patchClient(moduleExports);
      this._patchServer(moduleExports);
      this._patchTransports(moduleExports);
      this._patchFastMCP(moduleExports);
    } catch (e) {
      diag.error('Error in MCP _patchMain method', e as Error);
    }
  }

  private _unpatchMain(moduleExports: any): void {
    try {
      this._unpatchClient(moduleExports);
      this._unpatchServer(moduleExports);
      this._unpatchTransports(moduleExports);
      this._unpatchFastMCP(moduleExports);
    } catch {
      /* ignore unpatch errors */
    }
  }

  // -----------------------------------------------------------------------
  // Client + ClientSession
  // -----------------------------------------------------------------------

  private _patchClient(moduleExports: any): void {
    const Client = moduleExports.Client;
    if (!Client?.prototype) return;

    const clientMethods: Array<[string, (...args: any[]) => any]> = [
      ['callTool', patchCallTool(this.tracer, this._mcpVersion)],
      ['listTools', patchListTools(this.tracer, this._mcpVersion)],
      ['getPrompt', patchGetPrompt(this.tracer, this._mcpVersion)],
      ['listPrompts', patchListPrompts(this.tracer, this._mcpVersion)],
      ['readResource', patchReadResource(this.tracer, this._mcpVersion)],
      ['listResources', patchListResources(this.tracer, this._mcpVersion)],
    ];

    for (const [method, patcher] of clientMethods) {
      if (typeof Client.prototype[method] === 'function') {
        if (isWrapped(Client.prototype[method])) {
          this._unwrap(Client.prototype, method);
        }
        this._wrap(Client.prototype, method, patcher);
      }
    }

    // ClientSession (low-level)
    const ClientSession = moduleExports.ClientSession;
    if (ClientSession?.prototype) {
      const sessionMethods: Array<[string, (...args: any[]) => any]> = [
        ['sendRequest', patchClientSessionSendRequest(this.tracer, this._mcpVersion)],
        ['initialize', patchClientSessionInitialize(this.tracer, this._mcpVersion)],
        ['callTool', patchCallTool(this.tracer, this._mcpVersion)],
        ['listTools', patchListTools(this.tracer, this._mcpVersion)],
        ['readResource', patchReadResource(this.tracer, this._mcpVersion)],
        ['listResources', patchListResources(this.tracer, this._mcpVersion)],
      ];

      for (const [method, patcher] of sessionMethods) {
        if (typeof ClientSession.prototype[method] === 'function') {
          if (isWrapped(ClientSession.prototype[method])) {
            this._unwrap(ClientSession.prototype, method);
          }
          this._wrap(ClientSession.prototype, method, patcher);
        }
      }
    }
  }

  private _unpatchClient(moduleExports: any): void {
    const Client = moduleExports.Client;
    if (Client?.prototype) {
      for (const method of [
        'callTool', 'listTools', 'getPrompt', 'listPrompts', 'readResource', 'listResources',
      ]) {
        if (isWrapped(Client.prototype[method])) {
          this._unwrap(Client.prototype, method);
        }
      }
    }

    const ClientSession = moduleExports.ClientSession;
    if (ClientSession?.prototype) {
      for (const method of [
        'sendRequest', 'initialize', 'callTool', 'listTools', 'readResource', 'listResources',
      ]) {
        if (isWrapped(ClientSession.prototype[method])) {
          this._unwrap(ClientSession.prototype, method);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Server
  // -----------------------------------------------------------------------

  private _patchServer(moduleExports: any): void {
    const Server = moduleExports.Server;
    if (!Server?.prototype) return;

    const serverMethods: Array<[string, (...args: any[]) => any]> = [
      ['run', patchServerRun(this.tracer, this._mcpVersion)],
      ['callTool', patchServerCallTool(this.tracer, this._mcpVersion)],
      ['listTools', patchServerListTools(this.tracer, this._mcpVersion)],
      ['readResource', patchServerReadResource(this.tracer, this._mcpVersion)],
      ['listResources', patchServerListResources(this.tracer, this._mcpVersion)],
    ];

    for (const [method, patcher] of serverMethods) {
      if (typeof Server.prototype[method] === 'function') {
        if (isWrapped(Server.prototype[method])) {
          this._unwrap(Server.prototype, method);
        }
        this._wrap(Server.prototype, method, patcher);
      }
    }

    // ServerSession (low-level)
    const ServerSession = moduleExports.ServerSession;
    if (ServerSession?.prototype) {
      const sessionOps: Array<[string, string]> = [
        ['sendRequest', 'send_request'],
        ['sendNotification', 'send_notification'],
        ['sendLogMessage', 'send_log'],
      ];

      for (const [method, endpoint] of sessionOps) {
        if (typeof ServerSession.prototype[method] === 'function') {
          if (isWrapped(ServerSession.prototype[method])) {
            this._unwrap(ServerSession.prototype, method);
          }
          this._wrap(
            ServerSession.prototype,
            method,
            patchServerSessionOperation(endpoint, this.tracer, this._mcpVersion),
          );
        }
      }
    }
  }

  private _unpatchServer(moduleExports: any): void {
    const Server = moduleExports.Server;
    if (Server?.prototype) {
      for (const method of ['run', 'callTool', 'listTools', 'readResource', 'listResources']) {
        if (isWrapped(Server.prototype[method])) {
          this._unwrap(Server.prototype, method);
        }
      }
    }

    const ServerSession = moduleExports.ServerSession;
    if (ServerSession?.prototype) {
      for (const method of ['sendRequest', 'sendNotification', 'sendLogMessage']) {
        if (isWrapped(ServerSession.prototype[method])) {
          this._unwrap(ServerSession.prototype, method);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Transports (stdio, sse, websocket, streamablehttp)
  // -----------------------------------------------------------------------

  private _patchTransports(moduleExports: any): void {
    const transportClasses: Array<[string, string, string]> = [
      // [exportName, endpoint, methodName]
      ['StdioClientTransport', 'transport stdio_client', 'connect'],
      ['StdioServerTransport', 'transport stdio_server', 'connect'],
      ['SSEClientTransport', 'transport sse_client', 'connect'],
      ['SSEServerTransport', 'transport sse_server', 'connect'],
      ['StreamableHTTPClientTransport', 'transport http_client', 'connect'],
      ['StreamableHTTPServerTransport', 'transport http_server', 'connect'],
    ];

    for (const [exportName, endpoint, method] of transportClasses) {
      const TransportClass = moduleExports[exportName];
      if (!TransportClass?.prototype) continue;

      // Patch connect method on transport instances
      if (typeof TransportClass.prototype[method] === 'function') {
        if (isWrapped(TransportClass.prototype[method])) {
          this._unwrap(TransportClass.prototype, method);
        }
        this._wrap(
          TransportClass.prototype,
          method,
          patchTransport(endpoint, this.tracer, this._mcpVersion),
        );
      }
    }

    // Also try to patch transport factory functions (e.g. stdio_client, sse_client)
    const factoryFunctions: Array<[string, string]> = [
      ['stdio_client', 'transport stdio_client'],
      ['stdio_server', 'transport stdio_server'],
      ['sse_client', 'transport sse_client'],
      ['sse_server', 'transport sse_server'],
      ['streamablehttp_client', 'transport http_client'],
      ['streamablehttp_server', 'transport http_server'],
    ];

    for (const [fnName, endpoint] of factoryFunctions) {
      if (typeof moduleExports[fnName] === 'function') {
        if (isWrapped(moduleExports[fnName])) {
          this._unwrap(moduleExports, fnName);
        }
        this._wrap(
          moduleExports,
          fnName,
          patchTransport(endpoint, this.tracer, this._mcpVersion),
        );
      }
    }
  }

  private _unpatchTransports(moduleExports: any): void {
    const transportClasses = [
      'StdioClientTransport', 'StdioServerTransport',
      'SSEClientTransport', 'SSEServerTransport',
      'StreamableHTTPClientTransport', 'StreamableHTTPServerTransport',
    ];
    for (const exportName of transportClasses) {
      const TransportClass = moduleExports[exportName];
      if (TransportClass?.prototype && isWrapped(TransportClass.prototype.connect)) {
        this._unwrap(TransportClass.prototype, 'connect');
      }
    }

    const factoryFns = [
      'stdio_client', 'stdio_server', 'sse_client', 'sse_server',
      'streamablehttp_client', 'streamablehttp_server',
    ];
    for (const fnName of factoryFns) {
      if (isWrapped(moduleExports[fnName])) {
        this._unwrap(moduleExports, fnName);
      }
    }
  }

  // -----------------------------------------------------------------------
  // FastMCP
  // -----------------------------------------------------------------------

  private _patchFastMCP(moduleExports: any): void {
    const FastMCP = moduleExports.FastMCP;
    if (!FastMCP?.prototype) return;

    const fastMCPMethods: Array<[string, (...args: any[]) => any]> = [
      ['run', patchServerRun(this.tracer, this._mcpVersion)],
      ['callTool', patchServerCallTool(this.tracer, this._mcpVersion)],
      ['listTools', patchServerListTools(this.tracer, this._mcpVersion)],
      ['readResource', patchServerReadResource(this.tracer, this._mcpVersion)],
      ['listResources', patchServerListResources(this.tracer, this._mcpVersion)],
      ['getPrompt', patchGetPrompt(this.tracer, this._mcpVersion)],
      ['listPrompts', patchListPrompts(this.tracer, this._mcpVersion)],
    ];

    for (const [method, patcher] of fastMCPMethods) {
      if (typeof FastMCP.prototype[method] === 'function') {
        if (isWrapped(FastMCP.prototype[method])) {
          this._unwrap(FastMCP.prototype, method);
        }
        this._wrap(FastMCP.prototype, method, patcher);
      }
    }
  }

  private _unpatchFastMCP(moduleExports: any): void {
    const FastMCP = moduleExports.FastMCP;
    if (!FastMCP?.prototype) return;

    for (const method of [
      'run', 'callTool', 'listTools', 'readResource', 'listResources', 'getPrompt', 'listPrompts',
    ]) {
      if (isWrapped(FastMCP.prototype[method])) {
        this._unwrap(FastMCP.prototype, method);
      }
    }
  }
}
