"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const constant_1 = require("../constant");
class Vault {
    static async getSecrets(options) {
        const url = process.env.OPENLIT_URL || options.url || constant_1.OPENLIT_URL;
        const apiKey = process.env.OPENLIT_API_KEY || options.apiKey || '';
        const metaProperties = {
            applicationName: config_1.default.applicationName,
            environment: config_1.default.environment,
        };
        try {
            const vaultResponse = await fetch(`${url}/api/vault/get-secrets`, {
                method: 'POST',
                body: JSON.stringify({
                    key: options.key,
                    tags: options.tags,
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
            const { res = {} } = vaultResponse;
            if (options.shouldSetEnv) {
                Object.entries(res).forEach(([key, value]) => {
                    process.env[key] = value;
                });
            }
            return vaultResponse;
        }
        catch (e) {
            console.log(e);
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
exports.default = Vault;
//# sourceMappingURL=vault.js.map