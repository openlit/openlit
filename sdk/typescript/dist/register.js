"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = __importDefault(require("./index"));
const GLOBAL_SENTINEL = '__openlit_register_initialized__';
const MIN_NODE_MAJOR = 18;
function parseCSV(value) {
    if (!value)
        return undefined;
    const items = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return items.length > 0 ? items : undefined;
}
function parseResourceAttributes(value) {
    if (!value)
        return null;
    const attrs = {};
    for (const item of value.split(',')) {
        const [rawKey, ...rawValue] = item.split('=');
        const key = rawKey?.trim();
        const attrValue = rawValue.join('=').trim();
        if (key && attrValue)
            attrs[key] = attrValue;
    }
    return Object.keys(attrs).length > 0 ? attrs : null;
}
function nodeVersionSupported() {
    const major = Number(process.versions.node.split('.')[0]);
    return Number.isFinite(major) && major >= MIN_NODE_MAJOR;
}
function initFromEnv() {
    if (globalThis[GLOBAL_SENTINEL])
        return;
    globalThis[GLOBAL_SENTINEL] = true;
    if (!nodeVersionSupported()) {
        console.error(`OpenLIT auto-instrumentation requires Node.js ${MIN_NODE_MAJOR} or newer; current runtime is ${process.version}.`);
        return;
    }
    const options = {
        applicationName: process.env.OTEL_SERVICE_NAME,
        environment: process.env.OTEL_DEPLOYMENT_ENVIRONMENT,
        disabledInstrumentors: parseCSV(process.env.OPENLIT_DISABLED_INSTRUMENTORS),
        customSpanAttributes: parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES),
    };
    index_1.default.init(options);
}
initFromEnv();
//# sourceMappingURL=register.js.map