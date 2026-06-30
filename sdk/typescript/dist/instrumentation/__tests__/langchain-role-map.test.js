"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const helpers_1 = require("../../helpers");
describe('LangChain role mapping', () => {
    it('maps LangChain internal types to OTel GenAI roles', () => {
        expect(helpers_1.LANGCHAIN_ROLE_MAP.human).toBe('user');
        expect(helpers_1.LANGCHAIN_ROLE_MAP.ai).toBe('assistant');
        expect(helpers_1.OTEL_ASSISTANT_ROLE).toBe('assistant');
    });
    it('mapLangChainRole passes through already-normalised roles', () => {
        expect((0, helpers_1.mapLangChainRole)('user')).toBe('user');
        expect((0, helpers_1.mapLangChainRole)('assistant')).toBe('assistant');
    });
    it('mapLangChainRole defaults empty raw roles to assistant', () => {
        expect((0, helpers_1.mapLangChainRole)('')).toBe('assistant');
        expect((0, helpers_1.mapLangChainRole)(null)).toBe('assistant');
    });
});
//# sourceMappingURL=langchain-role-map.test.js.map