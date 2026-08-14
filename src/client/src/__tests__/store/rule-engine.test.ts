import { create } from 'zustand';
import { withLenses } from '@dhmk/zustand-lens';
import { ruleEngineStoreSlice } from '@/store/rule-engine';

const createStore = () => create<any>()(withLenses({ ruleEngine: ruleEngineStoreSlice }));

describe('ruleEngineStoreSlice', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  describe('initial state', () => {
    it('has empty fieldValuesCache', () => {
      expect(store.getState().ruleEngine.fieldValuesCache).toEqual({});
    });

    it('has empty fieldValuesLoading', () => {
      expect(store.getState().ruleEngine.fieldValuesLoading).toEqual({});
    });
  });

  describe('setFieldValues', () => {
    it('sets values for a field', () => {
      store.getState().ruleEngine.setFieldValues('model', ['gpt-4', 'gpt-3.5-turbo']);
      expect(store.getState().ruleEngine.fieldValuesCache['model']).toEqual(['gpt-4', 'gpt-3.5-turbo']);
    });

    it('sets values for multiple fields independently', () => {
      store.getState().ruleEngine.setFieldValues('model', ['gpt-4']);
      store.getState().ruleEngine.setFieldValues('status', ['OK', 'ERROR']);
      expect(store.getState().ruleEngine.fieldValuesCache['model']).toEqual(['gpt-4']);
      expect(store.getState().ruleEngine.fieldValuesCache['status']).toEqual(['OK', 'ERROR']);
    });

    it('overwrites existing values for the same field', () => {
      store.getState().ruleEngine.setFieldValues('model', ['gpt-4']);
      store.getState().ruleEngine.setFieldValues('model', ['claude-3']);
      expect(store.getState().ruleEngine.fieldValuesCache['model']).toEqual(['claude-3']);
    });

    it('sets an empty array', () => {
      store.getState().ruleEngine.setFieldValues('model', []);
      expect(store.getState().ruleEngine.fieldValuesCache['model']).toEqual([]);
    });
  });

  describe('setFieldValuesLoading', () => {
    it('sets loading true for a field', () => {
      store.getState().ruleEngine.setFieldValuesLoading('model', true);
      expect(store.getState().ruleEngine.fieldValuesLoading['model']).toBe(true);
    });

    it('sets loading false for a field', () => {
      store.getState().ruleEngine.setFieldValuesLoading('model', true);
      store.getState().ruleEngine.setFieldValuesLoading('model', false);
      expect(store.getState().ruleEngine.fieldValuesLoading['model']).toBe(false);
    });

    it('sets loading for multiple fields independently', () => {
      store.getState().ruleEngine.setFieldValuesLoading('model', true);
      store.getState().ruleEngine.setFieldValuesLoading('status', false);
      expect(store.getState().ruleEngine.fieldValuesLoading['model']).toBe(true);
      expect(store.getState().ruleEngine.fieldValuesLoading['status']).toBe(false);
    });
  });
});
