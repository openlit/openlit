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
Object.defineProperty(exports, "__esModule", { value: true });
exports.llmResponse = llmResponse;
exports.parseLlmResponse = parseLlmResponse;
async function llmResponse(provider, prompt, model, baseUrl, apiKey) {
    if (provider.toLowerCase() === 'openai') {
        const { llmResponseOpenAI } = await Promise.resolve().then(() => __importStar(require('./openai')));
        return llmResponseOpenAI({ prompt, model, baseUrl, apiKey });
    }
    else if (provider.toLowerCase() === 'anthropic') {
        const { llmResponseAnthropic } = await Promise.resolve().then(() => __importStar(require('./anthropic')));
        return llmResponseAnthropic({ prompt, model, apiKey });
    }
    else {
        throw new Error(`Unsupported provider: ${provider}`);
    }
}
function parseLlmResponse(response) {
    try {
        let data;
        if (typeof response === 'string') {
            data = JSON.parse(response);
        }
        else if (typeof response === 'object') {
            data = response;
        }
        else {
            throw new Error('Response must be a JSON string or an object.');
        }
        let verdict = 'none';
        if (typeof data.verdict === 'string') {
            if (data.verdict === 'yes' || data.verdict === 'no') {
                verdict = data.verdict;
            }
            else {
                // eslint-disable-next-line no-console
                console.warn(`Unexpected verdict value in LLM response: "${data.verdict}". Coercing to 'none'.`);
            }
        }
        return {
            score: typeof data.score === 'number' ? data.score : 0,
            verdict,
            guard: typeof data.guard === 'string' ? data.guard : 'none',
            classification: typeof data.classification === 'string' ? data.classification : 'none',
            explanation: typeof data.explanation === 'string' ? data.explanation : 'none',
        };
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.error('Error parsing LLM response:', e);
        return {
            score: 0,
            verdict: 'none',
            guard: 'none',
            classification: 'none',
            explanation: 'none'
        };
    }
}
//# sourceMappingURL=index.js.map