"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("./config"));
const constant_1 = require("./constant");
class PromptHub {
    static async getPrompts(options) {
        const url = process.env.OPENLIT_URL || options.url || constant_1.OPENLIT_URL;
        const apiKey = process.env.OPENLIT_API_KEY || options.apiKey || '';
        let metaProperties = {
            applicationName: config_1.default.applicationName,
            environment: config_1.default.environment,
        };
        if (options.metaProperties &&
            typeof options.metaProperties === 'object' &&
            !Array.isArray(options.metaProperties)) {
            metaProperties = {
                ...metaProperties,
                ...options.metaProperties,
            };
        }
        try {
            return await fetch(`${url}/api/prompt/get-compiled`, {
                method: 'POST',
                body: JSON.stringify({
                    name: options.name,
                    version: options.version,
                    shouldCompile: !!options.shouldCompile,
                    variables: options.variables || {},
                    id: options.promptId,
                    metaProperties,
                    source: 'ts-sdk',
                }),
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                },
            })
                .then(async (response) => {
                if (!response.ok) {
                    return {
                        err: `Openlit Error : HTTP error! Status: ${response.status}`,
                    };
                }
                return response.json();
            })
                .then((resp) => {
                return resp;
            });
        }
        catch (e) {
            if (e && typeof e.toString === 'function') {
                return {
                    err: `Openlit Error : ${e.toString()}`,
                    data: null,
                };
            }
            return {
                err: `Openlit Error : ${e}`,
            };
        }
    }
}
exports.default = PromptHub;
//# sourceMappingURL=prompt-hub.js.map