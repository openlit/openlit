import { renderHook, act } from '@testing-library/react';
import useFetchWrapper from '@/utils/hooks/useFetchWrapper';
import * as api from '@/utils/api';

jest.mock('@/utils/api');

const mockGetData = api.getData as jest.MockedFunction<typeof api.getData>;
const mockDeleteData = api.deleteData as jest.MockedFunction<typeof api.deleteData>;

describe('useFetchWrapper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useFetchWrapper());
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isFetched).toBe(false);
    expect(typeof result.current.fireRequest).toBe('function');
  });

  it('sets data on successful GET request', async () => {
    const mockData = { items: [1, 2, 3] };
    mockGetData.mockResolvedValue(mockData);

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/test',
        requestType: 'GET',
      });
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(result.current.isFetched).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('calls successCb with response data', async () => {
    const mockData = { result: 'success' };
    mockGetData.mockResolvedValue(mockData);
    const successCb = jest.fn();

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/test',
        requestType: 'GET',
        successCb,
      });
    });

    expect(successCb).toHaveBeenCalledWith(mockData);
  });

  it('extracts nested data via responseDataKey', async () => {
    const mockData = { nested: { value: 42 } };
    mockGetData.mockResolvedValue(mockData);

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/test',
        requestType: 'GET',
        responseDataKey: 'nested',
      });
    });

    expect(result.current.data).toEqual({ value: 42 });
  });

  it('handles response with err field', async () => {
    const mockErrorResponse = { err: 'Something went wrong' };
    mockGetData.mockResolvedValue(mockErrorResponse);
    const failureCb = jest.fn();

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/test',
        requestType: 'GET',
        failureCb,
      });
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Something went wrong');
    expect(failureCb).toHaveBeenCalledWith('Something went wrong');
  });

  it('handles thrown errors from the API call', async () => {
    mockGetData.mockRejectedValue(new Error('Network failure'));
    const failureCb = jest.fn();

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/test',
        requestType: 'GET',
        failureCb,
      });
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeTruthy();
    expect(result.current.isFetched).toBe(true);
    expect(failureCb).toHaveBeenCalled();
  });

  it('handles POST request the same as GET', async () => {
    const mockData = { created: true };
    mockGetData.mockResolvedValue(mockData);

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/items',
        requestType: 'POST',
        body: JSON.stringify({ name: 'Test' }),
      });
    });

    expect(mockGetData).toHaveBeenCalledWith({
      body: JSON.stringify({ name: 'Test' }),
      url: '/api/items',
      method: 'POST',
    });
    expect(result.current.data).toEqual(mockData);
  });

  it('calls deleteData for DELETE requests', async () => {
    const mockData = { deleted: true };
    mockDeleteData.mockResolvedValue(mockData);

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/test/1',
        requestType: 'DELETE',
      });
    });

    expect(mockDeleteData).toHaveBeenCalledWith({ url: '/api/test/1' });
    expect(result.current.data).toEqual(mockData);
  });

  it('handles thrown string error (covers line 54)', async () => {
    mockGetData.mockRejectedValue('plain string error');
    const failureCb = jest.fn();

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/test',
        requestType: 'GET',
        failureCb,
      });
    });

    expect(result.current.error).toBeTruthy();
    expect(failureCb).toHaveBeenCalled();
  });

  it('uses .error property when thrown object has no .message (covers line 56)', async () => {
    const errorObj = { error: 'api error message' };
    mockGetData.mockRejectedValue(errorObj);
    const failureCb = jest.fn();

    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({
        url: '/api/test',
        requestType: 'GET',
        failureCb,
      });
    });

    expect(result.current.error).toBeTruthy();
    expect(failureCb).toHaveBeenCalled();
  });

  it('resets error to null on new request', async () => {
    // First request fails
    mockGetData.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useFetchWrapper());

    await act(async () => {
      await result.current.fireRequest({ url: '/api/test', requestType: 'GET' });
    });
    expect(result.current.error).toBeTruthy();

    // Second request succeeds
    mockGetData.mockResolvedValue({ ok: true });
    await act(async () => {
      await result.current.fireRequest({ url: '/api/test', requestType: 'GET' });
    });
    expect(result.current.error).toBeNull();
  });
});
