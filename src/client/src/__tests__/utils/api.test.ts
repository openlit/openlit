import { getData, postData, deleteData } from '@/utils/api';
import { useRootStore } from '@/store';
import { OPENLIT_CONTEXT_HEADERS } from '@/constants/openlit-context';
import { __clearTelemetryRequestCache } from '@/utils/telemetry-request-cache';

jest.mock('@/store', () => ({
  useRootStore: {
    getState: jest.fn(),
  },
}));

const makeFetchResponse = (ok: boolean, body: unknown, status?: number) => ({
  ok,
  status: status ?? (ok ? 200 : 400),
  text: jest.fn().mockResolvedValue(
    typeof body === 'string' ? body : JSON.stringify(body ?? null)
  ),
  json: jest.fn().mockResolvedValue(body),
});

const mockEmptyScope = () => {
  (useRootStore.getState as jest.Mock).mockReturnValue({
    organisation: {},
    project: {},
    databaseConfig: {},
  });
};

const mockSelectedScope = (databaseList = [
  { id: 'db-1', isCurrent: false },
  { id: 'db-2', isCurrent: true },
]) => {
  (useRootStore.getState as jest.Mock).mockReturnValue({
    organisation: { current: { id: 'org-1' } },
    project: { current: { id: 'project-1' } },
    databaseConfig: {
      list: databaseList,
    },
  });
};

describe('getData', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    mockEmptyScope();
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
    mockSelectedScope();

    await getData({ url: '/api/test', method: 'GET' });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers).toEqual({
      [OPENLIT_CONTEXT_HEADERS.organisationId]: 'org-1',
      [OPENLIT_CONTEXT_HEADERS.projectId]: 'project-1',
      [OPENLIT_CONTEXT_HEADERS.databaseConfigId]: 'db-2',
    });
  });

  it('falls back to first database config when no current config is marked', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    mockSelectedScope([{ id: 'db-1' }, { id: 'db-2' }] as any);

    await getData({ url: '/api/test', method: 'GET' });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers[OPENLIT_CONTEXT_HEADERS.databaseConfigId]).toBe('db-1');
  });

  it('ignores non-array databaseConfig.list when building context headers', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    (useRootStore.getState as jest.Mock).mockReturnValue({
      organisation: { current: { id: 'org-1' } },
      project: { current: { id: 'project-1' } },
      databaseConfig: { list: '<html>login</html>' },
    });

    await getData({ url: '/api/test', method: 'GET' });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers[OPENLIT_CONTEXT_HEADERS.databaseConfigId]).toBeUndefined();
  });

  it('throws when a successful response is non-JSON (e.g. HTML login redirect)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(true, '<!DOCTYPE html><html>login</html>')
    );
    await expect(getData({ url: '/api/db-config', method: 'GET' })).rejects.toThrow(
      /non-JSON/i
    );
  });

  it('makes a PUT request when specified', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    await getData({ url: '/api/test', method: 'PUT', data: { x: 1 } });
    expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: 'PUT' }));
  });

  it('throws using the object error fallback fields when the failed response is JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { error: 'invalid input' }, 422)
    );
    await expect(getData({ url: '/api/test', method: 'GET' })).rejects.toThrow(
      'invalid input'
    );
  });

  it('falls back to a generic status message when the JSON error body has no known fields', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { unrelated: true }, 503)
    );
    await expect(getData({ url: '/api/test', method: 'GET' })).rejects.toThrow(
      'Request failed (503)'
    );
  });

  it('throws when a successful response body is empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, ''));
    await expect(getData({ url: '/api/test', method: 'GET' })).rejects.toThrow(
      /empty response/i
    );
  });

  it('includes the environment header and cache key when a current environment is set', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, {}));
    (useRootStore.getState as jest.Mock).mockReturnValue({
      organisation: {},
      project: { currentEnvironment: 'staging' },
      databaseConfig: {},
    });

    await getData({ url: '/api/test', method: 'GET' });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers).toEqual({
      [OPENLIT_CONTEXT_HEADERS.environment]: 'staging',
    });
  });

  it('caches cacheable telemetry URLs and issues a request signal via the abort controller', async () => {
    __clearTelemetryRequestCache();
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, { ok: true }));

    await getData({ url: '/api/metrics/summary', method: 'GET' });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.signal).toBeInstanceOf(AbortSignal);
    __clearTelemetryRequestCache();
  });
});

describe('postData', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    mockEmptyScope();
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

  it('merges JSON and OpenLIT context headers', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, { ok: true }));
    mockSelectedScope();

    await postData({ url: '/api/items', data: { name: 'test' } });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      [OPENLIT_CONTEXT_HEADERS.organisationId]: 'org-1',
      [OPENLIT_CONTEXT_HEADERS.projectId]: 'project-1',
      [OPENLIT_CONTEXT_HEADERS.databaseConfigId]: 'db-2',
    });
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

  it('throws using the object error fallback fields when the failed response is JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { err: 'duplicate key' }, 409)
    );
    await expect(postData({ url: '/api/items', data: {} })).rejects.toThrow(
      'duplicate key'
    );
  });

  it('falls back to the error field when err is absent', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { error: 'validation failed' }, 400)
    );
    await expect(postData({ url: '/api/items', data: {} })).rejects.toThrow(
      'validation failed'
    );
  });

  it('falls back to the message field when err and error are absent', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { message: 'unauthorized' }, 401)
    );
    await expect(postData({ url: '/api/items', data: {} })).rejects.toThrow(
      'unauthorized'
    );
  });

  it('falls back to a generic status message when the JSON error body has no known fields', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { unrelated: true }, 500)
    );
    await expect(postData({ url: '/api/items', data: {} })).rejects.toThrow(
      'Request failed (500)'
    );
  });

  it('throws when a successful response body is empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, ''));
    await expect(postData({ url: '/api/items', data: {} })).rejects.toThrow(
      /empty response/i
    );
  });
});

describe('deleteData', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    mockEmptyScope();
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

  it('sends OpenLIT context headers with DELETE requests', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, { deleted: true }));
    mockSelectedScope();

    await deleteData({ url: '/api/items/1' });

    expect(global.fetch).toHaveBeenCalledWith('/api/items/1', {
      method: 'DELETE',
      headers: {
        [OPENLIT_CONTEXT_HEADERS.organisationId]: 'org-1',
        [OPENLIT_CONTEXT_HEADERS.projectId]: 'project-1',
        [OPENLIT_CONTEXT_HEADERS.databaseConfigId]: 'db-2',
      },
    });
  });

  it('throws when response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(false, 'Not Found'));
    await expect(deleteData({ url: '/api/items/1' })).rejects.toThrow();
  });

  it('throws using the object error fallback fields when the failed response is JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { message: 'cannot delete in-use item' }, 409)
    );
    await expect(deleteData({ url: '/api/items/1' })).rejects.toThrow(
      'cannot delete in-use item'
    );
  });

  it('falls back to the error field when err is absent', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { error: 'referenced elsewhere' }, 409)
    );
    await expect(deleteData({ url: '/api/items/1' })).rejects.toThrow(
      'referenced elsewhere'
    );
  });

  it('falls back to a generic status message when the JSON error body has no known fields', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      makeFetchResponse(false, { unrelated: true }, 500)
    );
    await expect(deleteData({ url: '/api/items/1' })).rejects.toThrow(
      'Request failed (500)'
    );
  });

  it('throws when a successful response body is empty', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(makeFetchResponse(true, ''));
    await expect(deleteData({ url: '/api/items/1' })).rejects.toThrow(
      /empty response/i
    );
  });
});
