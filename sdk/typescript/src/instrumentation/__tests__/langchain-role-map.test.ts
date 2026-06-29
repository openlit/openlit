import {
  LANGCHAIN_ROLE_MAP,
  OTEL_ASSISTANT_ROLE,
  mapLangChainRole,
} from '../../helpers';

describe('LangChain role mapping', () => {
  it('maps LangChain internal types to OTel GenAI roles', () => {
    expect(LANGCHAIN_ROLE_MAP.human).toBe('user');
    expect(LANGCHAIN_ROLE_MAP.ai).toBe('assistant');
    expect(OTEL_ASSISTANT_ROLE).toBe('assistant');
  });

  it('mapLangChainRole passes through already-normalised roles', () => {
    expect(mapLangChainRole('user')).toBe('user');
    expect(mapLangChainRole('assistant')).toBe('assistant');
  });

  it('mapLangChainRole defaults empty raw roles to assistant', () => {
    expect(mapLangChainRole('')).toBe('assistant');
    expect(mapLangChainRole(null)).toBe('assistant');
  });
});
