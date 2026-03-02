import { create } from 'zustand';
import { withLenses } from '@dhmk/zustand-lens';
import { opengroundStoreSlice } from '@/store/openground';

const createStore = () =>
  create<any>()(withLenses({ openground: opengroundStoreSlice }));

describe('opengroundStoreSlice', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    // Mock fetch to prevent network calls from loadAvailableProviders
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initial state', () => {
    it('has empty selectedProviders', () => {
      expect(store.getState().openground.selectedProviders).toEqual([]);
    });

    it('has empty prompt', () => {
      expect(store.getState().openground.prompt).toBe('');
    });

    it('has isLoading false', () => {
      expect(store.getState().openground.isLoading).toBe(false);
    });

    it('has evaluatedResponse with isLoading false', () => {
      expect(store.getState().openground.evaluatedResponse.isLoading).toBe(false);
    });
  });

  describe('addProvider', () => {
    it('adds a provider to selectedProviders', () => {
      store.getState().openground.addProvider('openai', { api_key: 'sk-test' });
      const providers = store.getState().openground.selectedProviders;
      expect(providers).toHaveLength(1);
      expect(providers[0].provider).toBe('openai');
      expect(providers[0].config).toEqual({ api_key: 'sk-test' });
    });

    it('adds multiple providers', () => {
      store.getState().openground.addProvider('openai', {});
      store.getState().openground.addProvider('anthropic', {});
      expect(store.getState().openground.selectedProviders).toHaveLength(2);
    });

    it('defaults config to empty object', () => {
      store.getState().openground.addProvider('openai');
      expect(store.getState().openground.selectedProviders[0].config).toEqual({});
    });
  });

  describe('removeProvider', () => {
    it('removes a provider by index', () => {
      store.getState().openground.addProvider('openai', {});
      store.getState().openground.addProvider('anthropic', {});
      store.getState().openground.removeProvider(0);
      const providers = store.getState().openground.selectedProviders;
      expect(providers).toHaveLength(1);
      expect(providers[0].provider).toBe('anthropic');
    });

    it('removes the last provider', () => {
      store.getState().openground.addProvider('openai', {});
      store.getState().openground.removeProvider(0);
      expect(store.getState().openground.selectedProviders).toHaveLength(0);
    });
  });

  describe('setProviderConfig', () => {
    it('sets a config value at the given path', () => {
      store.getState().openground.addProvider('openai', { model: 'gpt-3.5-turbo' });
      store.getState().openground.setProviderConfig('[0].config.model', 'gpt-4');
      expect(store.getState().openground.selectedProviders[0].config.model).toBe('gpt-4');
    });
  });

  describe('setPrompt', () => {
    it('updates the prompt', () => {
      store.getState().openground.setPrompt('Hello, AI!');
      expect(store.getState().openground.prompt).toBe('Hello, AI!');
    });

    it('can clear the prompt', () => {
      store.getState().openground.setPrompt('Hello!');
      store.getState().openground.setPrompt('');
      expect(store.getState().openground.prompt).toBe('');
    });
  });

  describe('setEvaluatedLoading', () => {
    it('sets evaluatedResponse.isLoading to true', () => {
      store.getState().openground.setEvaluatedLoading(true);
      expect(store.getState().openground.evaluatedResponse.isLoading).toBe(true);
    });

    it('sets evaluatedResponse.isLoading back to false', () => {
      store.getState().openground.setEvaluatedLoading(true);
      store.getState().openground.setEvaluatedLoading(false);
      expect(store.getState().openground.evaluatedResponse.isLoading).toBe(false);
    });
  });

  describe('setEvaluatedData', () => {
    it('sets evaluatedResponse data and resets isLoading', () => {
      store.getState().openground.setEvaluatedLoading(true);
      const data = [{ provider: 'openai', response: 'Hello' }];
      store.getState().openground.setEvaluatedData(data);
      const { evaluatedResponse } = store.getState().openground;
      expect(evaluatedResponse.data).toEqual(data);
      expect(evaluatedResponse.isLoading).toBe(false);
    });
  });

  describe('setPromptSource', () => {
    it('updates the promptSource', () => {
      const source = { type: 'hub', content: 'Use this template', variables: { name: 'Alice' } };
      store.getState().openground.setPromptSource(source);
      expect(store.getState().openground.promptSource).toEqual(source);
    });
  });

  describe('setPromptVariable', () => {
    it('sets a variable in promptSource.variables', () => {
      store.getState().openground.setPromptVariable('name', 'Alice');
      expect(store.getState().openground.promptSource.variables.name).toBe('Alice');
    });

    it('merges variables without overwriting others', () => {
      store.getState().openground.setPromptVariable('name', 'Alice');
      store.getState().openground.setPromptVariable('role', 'admin');
      const { variables } = store.getState().openground.promptSource;
      expect(variables.name).toBe('Alice');
      expect(variables.role).toBe('admin');
    });
  });

  describe('addProviderNew / removeProviderNew / setProviderConfigNew / updateProviderModel', () => {
    it('addProviderNew adds a provider to selectedProvidersNew', () => {
      store.getState().openground.addProviderNew('openai', 'gpt-4', true);
      const providers = store.getState().openground.selectedProvidersNew;
      expect(providers).toHaveLength(1);
      expect(providers[0]).toMatchObject({ provider: 'openai', model: 'gpt-4', hasVaultConfig: true });
    });

    it('removeProviderNew removes by index', () => {
      store.getState().openground.addProviderNew('openai', 'gpt-4', false);
      store.getState().openground.addProviderNew('anthropic', 'claude-3', false);
      store.getState().openground.removeProviderNew(0);
      expect(store.getState().openground.selectedProvidersNew).toHaveLength(1);
      expect(store.getState().openground.selectedProvidersNew[0].provider).toBe('anthropic');
    });

    it('setProviderConfigNew merges config at index', () => {
      store.getState().openground.addProviderNew('openai', 'gpt-4', false);
      store.getState().openground.setProviderConfigNew(0, { api_key: 'sk-test' });
      expect(store.getState().openground.selectedProvidersNew[0].config).toMatchObject({
        api_key: 'sk-test',
      });
    });

    it('setProviderConfigNew does nothing for invalid index', () => {
      store.getState().openground.addProviderNew('openai', 'gpt-4', false);
      store.getState().openground.setProviderConfigNew(5, { api_key: 'sk-test' });
      expect(store.getState().openground.selectedProvidersNew).toHaveLength(1);
    });

    it('updateProviderModel updates model at index', () => {
      store.getState().openground.addProviderNew('openai', 'gpt-3.5-turbo', false);
      store.getState().openground.updateProviderModel(0, 'gpt-4');
      expect(store.getState().openground.selectedProvidersNew[0].model).toBe('gpt-4');
    });

    it('updateProviderModel does nothing for invalid index', () => {
      store.getState().openground.addProviderNew('openai', 'gpt-4', false);
      store.getState().openground.updateProviderModel(99, 'new-model');
      expect(store.getState().openground.selectedProvidersNew[0].model).toBe('gpt-4');
    });
  });

  describe('reset', () => {
    it('resets selectedProviders, prompt, isLoading, and evaluatedResponse', () => {
      store.getState().openground.addProvider('openai', {});
      store.getState().openground.setPrompt('Test prompt');
      store.getState().openground.setEvaluatedLoading(true);
      store.getState().openground.reset();
      const { selectedProviders, prompt, isLoading, evaluatedResponse } =
        store.getState().openground;
      expect(selectedProviders).toEqual([]);
      expect(prompt).toBe('');
      expect(isLoading).toBe(false);
      expect(evaluatedResponse.isLoading).toBe(false);
    });
  });
});
