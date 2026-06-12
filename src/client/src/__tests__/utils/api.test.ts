import { getData, postData, deleteData } from '@/utils/api';
import { useRootStore } from '@/store';

jest.mock('@/store', () => ({
  useRootStore: {
    getState: jest.fn(),
  },
}));

const makeFetchResponse = (ok: boolean, body: unknown) => ({
  ok,
  json: jest.fn().mockResolvedValue(body),
});

describe('getData', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    (useRootStore.getState as jest.Mock).mockReturnValue({
      organisation: {},
      project: {},
      databaseConfig: {},
    });
  });

  it('makes a POST request by default', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, { result: 'ok' }));
    await getData({ url: '/api/test' });
    expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'POST' }));
  });

  it('makes a GET request when specified', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    await getData({ url: '/api/test', method: 'GET' });
    expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'GET' }));
  });

  it('returns parsed JSON on success', async () => {
    const payload = { id: 1, name: 'Alice' };
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, payload));
    const result = await getData({ url: '/api/test', method: 'GET' });
    expect(result).toEqual(payload);
  });

  it('throws when response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(false, 'Not Found'));
    await expect(getData({ url: '/api/test', method: 'GET' })).rejects.toThrow();
  });

  it('sends body when provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    await getData({ url: '/api/test', body: '{"x":1}' });
    expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ body: '{"x":1}' }));
  });

  it('sends JSON body and Content-Type header when data is provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    await getData({ url: '/api/test', data: { key: 'value' } });
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.body).toBe(JSON.stringify({ key: 'value' }));
  });

  it('sends selected OpenLIT context headers when state has active scope', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    (useRootStore.getState as jest.Mock).mockReturnValue({
      organisation: { current: { id: 'org-1' } },
      project: { current: { id: 'project-1' } },
      databaseConfig: {
        list: [
          { id: 'db-1', isCurrent: false },
          { id: 'db-2', isCurrent: true },
        ],
      },
    });

    await getData({ url: '/api/test', method: 'GET' });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers).toEqual({
      'x-openlit-organisation-id': 'org-1',
      'x-openlit-project-id': 'project-1',
      'x-openlit-database-config-id': 'db-2',
    });
  });

  it('makes a PUT request when specified', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    await getData({ url: '/api/test', method: 'PUT', data: { x: 1 } });
    expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'PUT' }));
  });
});

describe('postData', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    (useRootStore.getState as jest.Mock).mockReturnValue({
      organisation: {},
      project: {},
      databaseConfig: {},
    });
  });

  it('makes a POST request with JSON body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, { ok: true }));
    const data = { name: 'test' };
    await postData({ url: '/api/items', data });
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/items');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.body).toBe(JSON.stringify(data));
  });

  it('returns parsed JSON on success', async () => {
    const response = { created: true, id: '42' };
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, response));
    const result = await postData({ url: '/api/items', data: {} });
    expect(result).toEqual(response);
  });

  it('throws when response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(false, 'Bad Request'));
    await expect(postData({ url: '/api/items', data: {} })).rejects.toThrow();
  });
});

describe('deleteData', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    (useRootStore.getState as jest.Mock).mockReturnValue({
      organisation: {},
      project: {},
      databaseConfig: {},
    });
  });

  it('makes a DELETE request to the given URL', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, { deleted: true }));
    await deleteData({ url: '/api/items/1' });
    expect(global.fetch).toHaveBeenCalledWith('/api/items/1', {
      method: 'DELETE',
      headers: {},
    });
  });

  it('returns parsed JSON on success', async () => {
    const response = { deleted: true };
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, response));
    const result = await deleteData({ url: '/api/items/1' });
    expect(result).toEqual(response);
  });

  it('throws when response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(false, 'Not Found'));
    await expect(deleteData({ url: '/api/items/1' })).rejects.toThrow();
  });
});
