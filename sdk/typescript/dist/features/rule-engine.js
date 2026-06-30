"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = __importDefault(require("../config"));
const constant_1 = require("../constant");
class RuleEngine {
    static async evaluateRule(options) {
        const url = process.env.OPENLIT_URL || options.url || constant_1.OPENLIT_URL;
        const apiKey = process.env.OPENLIT_API_KEY || options.apiKey || '';
        const metaProperties = {
            applicationName: config_1.default.applicationName,
            environment: config_1.default.environment,
        };
        try {
            const response = await fetch(`${url}/api/rule-engine/evaluate`, {
                method: 'POST',
                body: JSON.stringify({
                    entity_type: options.entityType,
                    fields: options.fields,
                    include_entity_data: options.includeEntityData || false,
                    entity_inputs: options.entityInputs,
                    metaProperties,
                    source: 'ts-sdk',
                }),
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
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
            return response;
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
exports.default = RuleEngine;
//# sourceMappingURL=rule-engine.js.map