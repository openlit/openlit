"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("@opentelemetry/api");
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = require("./wrapper");
class MCPInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-mcp`, '1.0.0', config);
        this._mcpVersion = 'unknown';
    }
    init() {
        // Main MCP SDK module — covers Client, Server, and FastMCP
        const mainModule = new instrumentation_1.InstrumentationNodeModuleDefinition('@modelcontextprotocol/sdk', ['>=1.0.0'], (moduleExports, moduleVersion) => {
            if (moduleVersion)
                this._mcpVersion = String(moduleVersion);
            this._patchMain(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatchMain(moduleExports);
            }
        });
        return [mainModule];
    }
    manualPatch(mcpSdk) {
        this._patchMain(mcpSdk);
    }
    // -----------------------------------------------------------------------
    // Main module patching — Client, Server, FastMCP, and transport classes
    // -----------------------------------------------------------------------
    _patchMain(moduleExports) {
        try {
            this._patchClient(moduleExports);
            this._patchServer(moduleExports);
            this._patchTransports(moduleExports);
            this._patchFastMCP(moduleExports);
        }
        catch (e) {
            api_1.diag.error('Error in MCP _patchMain method', e);
        }
    }
    _unpatchMain(moduleExports) {
        try {
            this._unpatchClient(moduleExports);
            this._unpatchServer(moduleExports);
            this._unpatchTransports(moduleExports);
            this._unpatchFastMCP(moduleExports);
        }
        catch {
            /* ignore unpatch errors */
        }
    }
    // -----------------------------------------------------------------------
    // Client + ClientSession
    // -----------------------------------------------------------------------
    _patchClient(moduleExports) {
        const Client = moduleExports.Client;
        if (!Client?.prototype)
            return;
        const clientMethods = [
            ['callTool', (0, wrapper_1.patchCallTool)(this.tracer, this._mcpVersion)],
            ['listTools', (0, wrapper_1.patchListTools)(this.tracer, this._mcpVersion)],
            ['getPrompt', (0, wrapper_1.patchGetPrompt)(this.tracer, this._mcpVersion)],
            ['listPrompts', (0, wrapper_1.patchListPrompts)(this.tracer, this._mcpVersion)],
            ['readResource', (0, wrapper_1.patchReadResource)(this.tracer, this._mcpVersion)],
            ['listResources', (0, wrapper_1.patchListResources)(this.tracer, this._mcpVersion)],
        ];
        for (const [method, patcher] of clientMethods) {
            if (typeof Client.prototype[method] === 'function') {
                if ((0, instrumentation_1.isWrapped)(Client.prototype[method])) {
                    this._unwrap(Client.prototype, method);
                }
                this._wrap(Client.prototype, method, patcher);
            }
        }
        // ClientSession (low-level)
        const ClientSession = moduleExports.ClientSession;
        if (ClientSession?.prototype) {
            const sessionMethods = [
                ['sendRequest', (0, wrapper_1.patchClientSessionSendRequest)(this.tracer, this._mcpVersion)],
                ['initialize', (0, wrapper_1.patchClientSessionInitialize)(this.tracer, this._mcpVersion)],
                ['callTool', (0, wrapper_1.patchCallTool)(this.tracer, this._mcpVersion)],
                ['listTools', (0, wrapper_1.patchListTools)(this.tracer, this._mcpVersion)],
                ['readResource', (0, wrapper_1.patchReadResource)(this.tracer, this._mcpVersion)],
                ['listResources', (0, wrapper_1.patchListResources)(this.tracer, this._mcpVersion)],
            ];
            for (const [method, patcher] of sessionMethods) {
                if (typeof ClientSession.prototype[method] === 'function') {
                    if ((0, instrumentation_1.isWrapped)(ClientSession.prototype[method])) {
                        this._unwrap(ClientSession.prototype, method);
                    }
                    this._wrap(ClientSession.prototype, method, patcher);
                }
            }
        }
    }
    _unpatchClient(moduleExports) {
        const Client = moduleExports.Client;
        if (Client?.prototype) {
            for (const method of [
                'callTool', 'listTools', 'getPrompt', 'listPrompts', 'readResource', 'listResources',
            ]) {
                if ((0, instrumentation_1.isWrapped)(Client.prototype[method])) {
                    this._unwrap(Client.prototype, method);
                }
            }
        }
        const ClientSession = moduleExports.ClientSession;
        if (ClientSession?.prototype) {
            for (const method of [
                'sendRequest', 'initialize', 'callTool', 'listTools', 'readResource', 'listResources',
            ]) {
                if ((0, instrumentation_1.isWrapped)(ClientSession.prototype[method])) {
                    this._unwrap(ClientSession.prototype, method);
                }
            }
        }
    }
    // -----------------------------------------------------------------------
    // Server
    // -----------------------------------------------------------------------
    _patchServer(moduleExports) {
        const Server = moduleExports.Server;
        if (!Server?.prototype)
            return;
        const serverMethods = [
            ['run', (0, wrapper_1.patchServerRun)(this.tracer, this._mcpVersion)],
            ['callTool', (0, wrapper_1.patchServerCallTool)(this.tracer, this._mcpVersion)],
            ['listTools', (0, wrapper_1.patchServerListTools)(this.tracer, this._mcpVersion)],
            ['readResource', (0, wrapper_1.patchServerReadResource)(this.tracer, this._mcpVersion)],
            ['listResources', (0, wrapper_1.patchServerListResources)(this.tracer, this._mcpVersion)],
        ];
        for (const [method, patcher] of serverMethods) {
            if (typeof Server.prototype[method] === 'function') {
                if ((0, instrumentation_1.isWrapped)(Server.prototype[method])) {
                    this._unwrap(Server.prototype, method);
                }
                this._wrap(Server.prototype, method, patcher);
            }
        }
        // ServerSession (low-level)
        const ServerSession = moduleExports.ServerSession;
        if (ServerSession?.prototype) {
            const sessionOps = [
                ['sendRequest', 'send_request'],
                ['sendNotification', 'send_notification'],
                ['sendLogMessage', 'send_log'],
            ];
            for (const [method, endpoint] of sessionOps) {
                if (typeof ServerSession.prototype[method] === 'function') {
                    if ((0, instrumentation_1.isWrapped)(ServerSession.prototype[method])) {
                        this._unwrap(ServerSession.prototype, method);
                    }
                    this._wrap(ServerSession.prototype, method, (0, wrapper_1.patchServerSessionOperation)(endpoint, this.tracer, this._mcpVersion));
                }
            }
        }
    }
    _unpatchServer(moduleExports) {
        const Server = moduleExports.Server;
        if (Server?.prototype) {
            for (const method of ['run', 'callTool', 'listTools', 'readResource', 'listResources']) {
                if ((0, instrumentation_1.isWrapped)(Server.prototype[method])) {
                    this._unwrap(Server.prototype, method);
                }
            }
        }
        const ServerSession = moduleExports.ServerSession;
        if (ServerSession?.prototype) {
            for (const method of ['sendRequest', 'sendNotification', 'sendLogMessage']) {
                if ((0, instrumentation_1.isWrapped)(ServerSession.prototype[method])) {
                    this._unwrap(ServerSession.prototype, method);
                }
            }
        }
    }
    // -----------------------------------------------------------------------
    // Transports (stdio, sse, websocket, streamablehttp)
    // -----------------------------------------------------------------------
    _patchTransports(moduleExports) {
        const transportClasses = [
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
            if (!TransportClass?.prototype)
                continue;
            // Patch connect method on transport instances
            if (typeof TransportClass.prototype[method] === 'function') {
                if ((0, instrumentation_1.isWrapped)(TransportClass.prototype[method])) {
                    this._unwrap(TransportClass.prototype, method);
                }
                this._wrap(TransportClass.prototype, method, (0, wrapper_1.patchTransport)(endpoint, this.tracer, this._mcpVersion));
            }
        }
        // Also try to patch transport factory functions (e.g. stdio_client, sse_client)
        const factoryFunctions = [
            ['stdio_client', 'transport stdio_client'],
            ['stdio_server', 'transport stdio_server'],
            ['sse_client', 'transport sse_client'],
            ['sse_server', 'transport sse_server'],
            ['streamablehttp_client', 'transport http_client'],
            ['streamablehttp_server', 'transport http_server'],
        ];
        for (const [fnName, endpoint] of factoryFunctions) {
            if (typeof moduleExports[fnName] === 'function') {
                if ((0, instrumentation_1.isWrapped)(moduleExports[fnName])) {
                    this._unwrap(moduleExports, fnName);
                }
                this._wrap(moduleExports, fnName, (0, wrapper_1.patchTransport)(endpoint, this.tracer, this._mcpVersion));
            }
        }
    }
    _unpatchTransports(moduleExports) {
        const transportClasses = [
            'StdioClientTransport', 'StdioServerTransport',
            'SSEClientTransport', 'SSEServerTransport',
            'StreamableHTTPClientTransport', 'StreamableHTTPServerTransport',
        ];
        for (const exportName of transportClasses) {
            const TransportClass = moduleExports[exportName];
            if (TransportClass?.prototype && (0, instrumentation_1.isWrapped)(TransportClass.prototype.connect)) {
                this._unwrap(TransportClass.prototype, 'connect');
            }
        }
        const factoryFns = [
            'stdio_client', 'stdio_server', 'sse_client', 'sse_server',
            'streamablehttp_client', 'streamablehttp_server',
        ];
        for (const fnName of factoryFns) {
            if ((0, instrumentation_1.isWrapped)(moduleExports[fnName])) {
                this._unwrap(moduleExports, fnName);
            }
        }
    }
    // -----------------------------------------------------------------------
    // FastMCP
    // -----------------------------------------------------------------------
    _patchFastMCP(moduleExports) {
        const FastMCP = moduleExports.FastMCP;
        if (!FastMCP?.prototype)
            return;
        const fastMCPMethods = [
            ['run', (0, wrapper_1.patchServerRun)(this.tracer, this._mcpVersion)],
            ['callTool', (0, wrapper_1.patchServerCallTool)(this.tracer, this._mcpVersion)],
            ['listTools', (0, wrapper_1.patchServerListTools)(this.tracer, this._mcpVersion)],
            ['readResource', (0, wrapper_1.patchServerReadResource)(this.tracer, this._mcpVersion)],
            ['listResources', (0, wrapper_1.patchServerListResources)(this.tracer, this._mcpVersion)],
            ['getPrompt', (0, wrapper_1.patchGetPrompt)(this.tracer, this._mcpVersion)],
            ['listPrompts', (0, wrapper_1.patchListPrompts)(this.tracer, this._mcpVersion)],
        ];
        for (const [method, patcher] of fastMCPMethods) {
            if (typeof FastMCP.prototype[method] === 'function') {
                if ((0, instrumentation_1.isWrapped)(FastMCP.prototype[method])) {
                    this._unwrap(FastMCP.prototype, method);
                }
                this._wrap(FastMCP.prototype, method, patcher);
            }
        }
    }
    _unpatchFastMCP(moduleExports) {
        const FastMCP = moduleExports.FastMCP;
        if (!FastMCP?.prototype)
            return;
        for (const method of [
            'run', 'callTool', 'listTools', 'readResource', 'listResources', 'getPrompt', 'listPrompts',
        ]) {
            if ((0, instrumentation_1.isWrapped)(FastMCP.prototype[method])) {
                this._unwrap(FastMCP.prototype, method);
            }
        }
    }
}
exports.default = MCPInstrumentation;
//# sourceMappingURL=index.js.map