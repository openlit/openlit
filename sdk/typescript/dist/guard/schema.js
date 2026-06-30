"use strict";
/**
 * Schema validation guard for structured LLM outputs.
 *
 * Validates that model output is valid JSON and/or conforms to a JSON schema.
 *
 * Must stay in sync with: sdk/python/src/openlit/guard/schema.py
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Schema = void 0;
const base_1 = require("./base");
function validateJsonSchema(data, schema, path = '') {
    const schemaType = schema.type;
    if (schemaType) {
        const typeMap = {
            object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
            array: (v) => Array.isArray(v),
            string: (v) => typeof v === 'string',
            number: (v) => typeof v === 'number',
            integer: (v) => typeof v === 'number' && Number.isInteger(v),
            boolean: (v) => typeof v === 'boolean',
            null: (v) => v === null,
        };
        const checker = typeMap[schemaType];
        if (checker && !checker(data)) {
            const actual = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
            return `Expected ${schemaType} at ${path || 'root'}, got ${actual}`;
        }
    }
    if (schemaType === 'object' && typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const dataObj = data;
        const required = schema.required || [];
        for (const fieldName of required) {
            if (!(fieldName in dataObj)) {
                return `Missing required field '${fieldName}' at ${path || 'root'}`;
            }
        }
        const properties = schema.properties || {};
        for (const [propName, propSchema] of Object.entries(properties)) {
            if (propName in dataObj) {
                const err = validateJsonSchema(dataObj[propName], propSchema, `${path}.${propName}`);
                if (err)
                    return err;
            }
        }
    }
    if (schemaType === 'array' && Array.isArray(data)) {
        const itemsSchema = schema.items;
        if (itemsSchema) {
            for (let i = 0; i < data.length; i++) {
                const err = validateJsonSchema(data[i], itemsSchema, `${path}[${i}]`);
                if (err)
                    return err;
            }
        }
    }
    return null;
}
class Schema extends base_1.Guard {
    constructor(opts = {}) {
        super({ action: opts.action ?? 'deny', maxScanLength: opts.maxScanLength });
        this.name = 'schema';
        this.phases = [base_1.GuardPhase.POSTFLIGHT];
        this._jsonMode = opts.jsonMode ?? false;
        this._schema = opts.schema ?? null;
    }
    evaluate(text) {
        const stripped = text.trim();
        let parsed;
        try {
            parsed = JSON.parse(stripped);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return (0, base_1.makeGuardResult)({
                action: this._action,
                score: 1.0,
                guardName: this.name,
                classification: 'invalid_json',
                explanation: `Output is not valid JSON: ${message}`,
            });
        }
        if (this._schema) {
            const err = validateJsonSchema(parsed, this._schema);
            if (err) {
                return (0, base_1.makeGuardResult)({
                    action: this._action,
                    score: 0.9,
                    guardName: this.name,
                    classification: 'schema_mismatch',
                    explanation: err,
                });
            }
        }
        return (0, base_1.makeGuardResult)({ guardName: this.name });
    }
}
exports.Schema = Schema;
//# sourceMappingURL=schema.js.map