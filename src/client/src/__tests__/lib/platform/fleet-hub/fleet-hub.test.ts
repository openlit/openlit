jest.mock('@/utils/asaw', () => jest.fn());

import { getAllAgents, getAgentByInstanceId, updateAgentConfig, updateTlsConnection } from '@/lib/platform/fleet-hub/index';
import asaw from '@/utils/asaw';

// Use fake timers to skip the 2-second delay in updateAgentConfig
jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllMocks();
  // fleet-hub uses asaw(fetch(...)) – need global.fetch to avoid ReferenceError
  global.fetch = jest.fn();
});

describe('getAllAgents', () => {
  it('returns agents data on success', async () => {
    const mockData = [{ id: 'agent-1', name: 'Collector' }];
    const mockResponse = { json: jest.fn().mockResolvedValue(mockData), ok: true };
    (asaw as jest.Mock).mockResolvedValue([null, mockResponse]);

    const result = await getAllAgents();
    expect(result.data).toEqual(mockData);
    expect(result.err).toBeUndefined();
  });

  it('returns err on fetch failure', async () => {
    (asaw as jest.Mock).mockResolvedValue([new Error('Network error'), null]);
    const result = await getAllAgents();
    expect(result.err).toBeDefined();
  });
});

describe('getAgentByInstanceId', () => {
  it('returns agent data for given id', async () => {
    const mockAgent = { id: 'agent-1', config: {} };
    const mockResponse = { json: jest.fn().mockResolvedValue(mockAgent) };
    (asaw as jest.Mock).mockResolvedValue([null, mockResponse]);

    const result = await getAgentByInstanceId('agent-1');
    expect(result.data).toEqual(mockAgent);
  });

  it('returns err on fetch failure', async () => {
    (asaw as jest.Mock).mockResolvedValue([new Error('Network error'), null]);
    const result = await getAgentByInstanceId('agent-1');
    expect(result.err).toBeDefined();
  });
});

describe('updateAgentConfig', () => {
  it('returns data on success (after timer resolves)', async () => {
    const mockResponse = { ok: true };
    (asaw as jest.Mock).mockResolvedValue([null, mockResponse]);

    // Use jest.advanceTimersByTimeAsync to properly handle async setTimeout
    const promise = updateAgentConfig('agent-1', '{"key":"value"}');
    await jest.advanceTimersByTimeAsync(2001);
    const result = await promise;
    expect(result.data).toBeDefined();
    expect(result.err).toBeUndefined();
  });

  it('returns err on fetch error', async () => {
    const mockError = new Error('Connection refused');
    mockError.message = 'Connection refused';
    (asaw as jest.Mock).mockResolvedValue([mockError, null]);

    const result = await updateAgentConfig('agent-1', '{}');
    expect(result.err).toBe('Connection refused');
    expect(result.status).toBe(500);
  });

  it('returns HTTP error when response is not ok', async () => {
    const mockResponse = { ok: false, status: 400, statusText: 'Bad Request', text: jest.fn().mockResolvedValue('Invalid config') };
    (asaw as jest.Mock).mockResolvedValue([null, mockResponse]);

    const result = await updateAgentConfig('agent-1', 'invalid');
    expect(result.err).toContain('Invalid config');
    expect(result.status).toBe(400);
  });

  it('uses "Failed to save configuration" fallback when err has no message', async () => {
    const errWithoutMessage = {};
    (asaw as jest.Mock).mockResolvedValue([errWithoutMessage, null]);

    const result = await updateAgentConfig('agent-1', '{}');
    expect(result.err).toBe('Failed to save configuration');
    expect(result.status).toBe(500);
  });

  it('uses HTTP status fallback when errorText is empty', async () => {
    const mockResponse = { ok: false, status: 503, statusText: 'Service Unavailable', text: jest.fn().mockResolvedValue('') };
    (asaw as jest.Mock).mockResolvedValue([null, mockResponse]);

    const result = await updateAgentConfig('agent-1', '{}');
    expect(result.err).toContain('503');
    expect(result.status).toBe(503);
  });
});

describe('updateTlsConnection', () => {
  it('returns data on success', async () => {
    const mockResponse = { ok: true };
    (asaw as jest.Mock).mockResolvedValue([null, mockResponse]);

    const result = await updateTlsConnection('agent-1', '1.2');
    expect(result.data).toBeDefined();
  });

  it('returns err on failure', async () => {
    (asaw as jest.Mock).mockResolvedValue([new Error('Connection error'), null]);
    const result = await updateTlsConnection('agent-1', '1.2');
    expect(result.err).toBeDefined();
  });
});
