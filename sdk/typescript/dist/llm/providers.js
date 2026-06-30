"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.llmProviders = void 0;
const openai_1 = require("./openai");
const anthropic_1 = require("./anthropic");
exports.llmProviders = {
    openai: openai_1.llmResponseOpenAI,
    anthropic: anthropic_1.llmResponseAnthropic,
};
//# sourceMappingURL=providers.js.map