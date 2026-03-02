import {
  getDashboardType,
  getVisibilityColumnsOfPage,
  setPageData,
} from '@/selectors/page';

const makeState = (overrides: Record<string, any> = {}) =>
  ({
    page: {
      dashboard: { type: 'llm' },
      request: { visibilityColumns: { id: true, time: true, requestDuration: false } },
      exception: { visibilityColumns: { id: true, time: false } },
      fleethub: { visibilityColumns: { id: true } },
      setData: jest.fn(),
      header: { title: 'Home', breadcrumbs: [] },
      setHeader: jest.fn(),
      ...overrides,
    },
  } as any);

describe('getDashboardType', () => {
  it('returns the dashboard type', () => {
    expect(getDashboardType(makeState())).toBe('llm');
  });

  it('returns vector type when set', () => {
    const state = makeState({ dashboard: { type: 'vector' } });
    expect(getDashboardType(state)).toBe('vector');
  });

  it('returns gpu type when set', () => {
    const state = makeState({ dashboard: { type: 'gpu' } });
    expect(getDashboardType(state)).toBe('gpu');
  });
});

describe('getVisibilityColumnsOfPage', () => {
  it('returns visibility columns for the request page', () => {
    const state = makeState();
    const columns = getVisibilityColumnsOfPage(state, 'request');
    expect(columns).toEqual({ id: true, time: true, requestDuration: false });
  });

  it('returns visibility columns for the exception page', () => {
    const state = makeState();
    const columns = getVisibilityColumnsOfPage(state, 'exception');
    expect(columns).toEqual({ id: true, time: false });
  });

  it('returns visibility columns for the fleethub page', () => {
    const state = makeState();
    const columns = getVisibilityColumnsOfPage(state, 'fleethub');
    expect(columns).toEqual({ id: true });
  });
});

describe('setPageData', () => {
  it('returns the setData function from state', () => {
    const state = makeState();
    expect(setPageData(state)).toBe(state.page.setData);
  });
});
