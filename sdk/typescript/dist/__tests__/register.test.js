"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
describe('openlit/register', () => {
    const originalEnv = process.env;
    const originalVersion = process.versions.node;
    let initMock;
    beforeEach(() => {
        jest.resetModules();
        initMock = jest.fn();
        jest.doMock('../index', () => ({
            __esModule: true,
            default: { init: initMock },
        }));
        process.env = {
            ...originalEnv,
            OTEL_SERVICE_NAME: 'node-ai-app',
            OTEL_DEPLOYMENT_ENVIRONMENT: 'prod',
            OTEL_RESOURCE_ATTRIBUTES: 'service.workload.key=k8s:demo,team=ai',
            OPENLIT_DISABLED_INSTRUMENTORS: 'openai,anthropic',
        };
        delete globalThis.__openlit_register_initialized__;
    });
    afterEach(() => {
        process.env = originalEnv;
        Object.defineProperty(process.versions, 'node', {
            value: originalVersion,
            configurable: true,
        });
        delete globalThis.__openlit_register_initialized__;
        jest.dontMock('../index');
    });
    it('initializes once with controller environment values', async () => {
        await Promise.resolve().then(() => __importStar(require('../register')));
        await Promise.resolve().then(() => __importStar(require('../register')));
        expect(initMock).toHaveBeenCalledTimes(1);
        expect(initMock).toHaveBeenCalledWith({
            applicationName: 'node-ai-app',
            environment: 'prod',
            disabledInstrumentors: ['openai', 'anthropic'],
            customSpanAttributes: {
                'service.workload.key': 'k8s:demo',
                team: 'ai',
            },
        });
    });
    it('skips unsupported Node.js versions', async () => {
        Object.defineProperty(process.versions, 'node', {
            value: '16.20.2',
            configurable: true,
        });
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        await Promise.resolve().then(() => __importStar(require('../register')));
        expect(initMock).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires Node.js 18 or newer'));
        errorSpy.mockRestore();
    });
});
//# sourceMappingURL=register.test.js.map