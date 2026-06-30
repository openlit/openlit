import { InstrumentationBase, InstrumentationModuleDefinition } from '@opentelemetry/instrumentation';
import { InstrumentationConfig } from '@opentelemetry/instrumentation';
export interface MCPInstrumentationConfig extends InstrumentationConfig {
}
export default class MCPInstrumentation extends InstrumentationBase {
    private _mcpVersion;
    constructor(config?: MCPInstrumentationConfig);
    protected init(): void | InstrumentationModuleDefinition | InstrumentationModuleDefinition[];
    manualPatch(mcpSdk: any): void;
    private _patchMain;
    private _unpatchMain;
    private _patchClient;
    private _unpatchClient;
    private _patchServer;
    private _unpatchServer;
    private _patchTransports;
    private _unpatchTransports;
    private _patchFastMCP;
    private _unpatchFastMCP;
}
