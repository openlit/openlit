"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const instrumentation_1 = require("@opentelemetry/instrumentation");
const constant_1 = require("../../constant");
const wrapper_1 = __importDefault(require("./wrapper"));
class OpenlitAzureAIInferenceInstrumentation extends instrumentation_1.InstrumentationBase {
    constructor(config = {}) {
        super(`${constant_1.INSTRUMENTATION_PREFIX}/instrumentation-azure-ai-inference`, '1.0.0', config);
    }
    init() {
        const module = new instrumentation_1.InstrumentationNodeModuleDefinition('@azure-rest/ai-inference', ['>=1.0.0-beta.1'], (moduleExports) => {
            this._patch(moduleExports);
            return moduleExports;
        }, (moduleExports) => {
            if (moduleExports !== undefined) {
                this._unpatch(moduleExports);
            }
        });
        return [module];
    }
    manualPatch(azureAIInference) {
        this._patch(azureAIInference);
    }
    _patch(moduleExports) {
        try {
            if (!moduleExports.default || typeof moduleExports.default !== 'function') {
                return;
            }
            if ((0, instrumentation_1.isWrapped)(moduleExports.default)) {
                this._unwrap(moduleExports, 'default');
            }
            const tracer = this.tracer;
            this._wrap(moduleExports, 'default', (original) => {
                return function (...args) {
                    const client = original.apply(this, args);
                    const endpoint = typeof args[0] === 'string' ? args[0] : '';
                    const { serverAddress, serverPort } = wrapper_1.default.parseEndpoint(endpoint);
                    if (client && typeof client.path === 'function') {
                        const originalPath = client.path;
                        client.path = function (...pathArgs) {
                            const route = pathArgs[0];
                            const handler = originalPath.apply(client, pathArgs);
                            if (route === '/chat/completions' &&
                                handler &&
                                typeof handler.post === 'function') {
                                const origPost = handler.post;
                                handler.post = wrapper_1.default._patchChatComplete(tracer, serverAddress, serverPort)(origPost);
                            }
                            else if (route === '/embeddings' &&
                                handler &&
                                typeof handler.post === 'function') {
                                const origPost = handler.post;
                                handler.post = wrapper_1.default._patchEmbeddings(tracer, serverAddress, serverPort)(origPost);
                            }
                            return handler;
                        };
                    }
                    return client;
                };
            });
        }
        catch (e) {
            console.error('Error in _patch method:', e);
        }
    }
    _unpatch(moduleExports) {
        if (moduleExports.default) {
            this._unwrap(moduleExports, 'default');
        }
    }
}
exports.default = OpenlitAzureAIInferenceInstrumentation;
//# sourceMappingURL=index.js.map