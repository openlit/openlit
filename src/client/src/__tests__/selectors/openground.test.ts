import {
  getSelectedProviders,
  getPrompt,
  getIsLoading,
  setProviderConfig,
  addProvider,
  removeProvider,
  setPrompt,
  resetOpenground,
  getEvaluatedResponse,
  setEvaluatedLoading,
  setEvaluatedData,
} from '@/selectors/openground';

const makeState = (overrides: Record<string, any> = {}) =>
  ({
    openground: {
      selectedProviders: [{ id: 'openai', model: 'gpt-4' }],
      prompt: 'Hello, world!',
      isLoading: false,
      evaluatedResponse: { score: 0.95 },
      setProviderConfig: jest.fn(),
      addProvider: jest.fn(),
      removeProvider: jest.fn(),
      setPrompt: jest.fn(),
      reset: jest.fn(),
      setEvaluatedLoading: jest.fn(),
      setEvaluatedData: jest.fn(),
      ...overrides,
    },
  } as any);

describe('getSelectedProviders', () => {
  it('returns the selected providers array', () => {
    const state = makeState();
    expect(getSelectedProviders(state)).toEqual([{ id: 'openai', model: 'gpt-4' }]);
  });

  it('returns empty array when no providers selected', () => {
    const state = makeState({ selectedProviders: [] });
    expect(getSelectedProviders(state)).toEqual([]);
  });
});

describe('getPrompt', () => {
  it('returns the current prompt', () => {
    const state = makeState();
    expect(getPrompt(state)).toBe('Hello, world!');
  });

  it('returns empty string when prompt is empty', () => {
    const state = makeState({ prompt: '' });
    expect(getPrompt(state)).toBe('');
  });
});

describe('getIsLoading', () => {
  it('returns false when not loading', () => {
    expect(getIsLoading(makeState())).toBe(false);
  });

  it('returns true when loading', () => {
    expect(getIsLoading(makeState({ isLoading: true }))).toBe(true);
  });
});

describe('setProviderConfig', () => {
  it('returns the setProviderConfig function', () => {
    const state = makeState();
    expect(setProviderConfig(state)).toBe(state.openground.setProviderConfig);
  });
});

describe('addProvider', () => {
  it('returns the addProvider function', () => {
    const state = makeState();
    expect(addProvider(state)).toBe(state.openground.addProvider);
  });
});

describe('removeProvider', () => {
  it('returns the removeProvider function', () => {
    const state = makeState();
    expect(removeProvider(state)).toBe(state.openground.removeProvider);
  });
});

describe('setPrompt', () => {
  it('returns the setPrompt function', () => {
    const state = makeState();
    expect(setPrompt(state)).toBe(state.openground.setPrompt);
  });
});

describe('resetOpenground', () => {
  it('returns the reset function', () => {
    const state = makeState();
    expect(resetOpenground(state)).toBe(state.openground.reset);
  });
});

describe('getEvaluatedResponse', () => {
  it('returns the evaluatedResponse', () => {
    const state = makeState();
    expect(getEvaluatedResponse(state)).toEqual({ score: 0.95 });
  });

  it('returns undefined when no evaluated response', () => {
    const state = makeState({ evaluatedResponse: undefined });
    expect(getEvaluatedResponse(state)).toBeUndefined();
  });
});

describe('setEvaluatedLoading', () => {
  it('returns the setEvaluatedLoading function', () => {
    const state = makeState();
    expect(setEvaluatedLoading(state)).toBe(state.openground.setEvaluatedLoading);
  });
});

describe('setEvaluatedData', () => {
  it('returns the setEvaluatedData function', () => {
    const state = makeState();
    expect(setEvaluatedData(state)).toBe(state.openground.setEvaluatedData);
  });
});
