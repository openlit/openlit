jest.mock('@/lib/platform/api-keys', () => ({
  getAPIKeyInfo: jest.fn(),
}));
jest.mock('@/lib/platform/evaluation/config', () => ({
  getEvaluationConfigByDbConfigId: jest.fn(),
}));
jest.mock('@/constants/messages', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    NO_API_KEY: 'No API key provided',
  })),
}));
jest.mock('@/utils/asaw', () =>
  jest.fn(async (promise: Promise<any>) => {
    try {
      const result = await promise;
      return [null, result];
    } catch (err) {
      return [err, null];
    }
  })
);

import {
  authenticateOfflineApiKey,
  loadOfflineEvaluationConfig,
  EVALUATION_NOT_CONFIGURED_MESSAGE,
} from '@/lib/platform/evaluation/offline-auth';
import { getAPIKeyInfo } from '@/lib/platform/api-keys';
import { getEvaluationConfigByDbConfigId } from '@/lib/platform/evaluation/config';

class TestResponse {
  status: number;
  private body: unknown;

  constructor(body?: unknown, init?: { status?: number }) {
    this.body = body;
    this.status = init?.status ?? 200;
  }

  static json(body: unknown, init?: { status?: number }) {
    return new TestResponse(body, init);
  }

  async json() {
    return this.body;
  }
}

(global as any).Response = TestResponse;

function makeRequest(authorization?: string) {
  return {
    headers: {
      get: (key: string) => (key.toLowerCase() === 'authorization' ? authorization ?? null : null),
    },
  } as unknown as Request;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authenticateOfflineApiKey', () => {
  it('returns a 401 error when no Authorization header is present', async () => {
    const result = await authenticateOfflineApiKey(makeRequest());
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(401);
    }
    expect(getAPIKeyInfo).not.toHaveBeenCalled();
  });

  it('returns a 401 error when the Authorization header is not a Bearer token', async () => {
    const result = await authenticateOfflineApiKey(makeRequest('Basic abc123'));
    expect('error' in result).toBe(true);
    expect(getAPIKeyInfo).not.toHaveBeenCalled();
  });

  it('returns a 401 error when the Bearer token is empty', async () => {
    const result = await authenticateOfflineApiKey(makeRequest('Bearer '));
    expect('error' in result).toBe(true);
    expect(getAPIKeyInfo).not.toHaveBeenCalled();
  });

  it('returns a 401 error when the API key is not found', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([new Error('not found'), null]);
    const result = await authenticateOfflineApiKey(makeRequest('Bearer openlit-key'));
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(401);
    }
  });

  it('returns a 401 error when the API key has no databaseConfigId', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, {}]);
    const result = await authenticateOfflineApiKey(makeRequest('Bearer openlit-key'));
    expect('error' in result).toBe(true);
  });

  it('returns the databaseConfigId for a valid API key', async () => {
    (getAPIKeyInfo as jest.Mock).mockResolvedValue([null, { databaseConfigId: 'db-1' }]);
    const result = await authenticateOfflineApiKey(makeRequest('Bearer openlit-key'));
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.databaseConfigId).toBe('db-1');
    }
  });
});

describe('loadOfflineEvaluationConfig', () => {
  it('calls the caller-provided notConfiguredResponse when the config lookup fails', async () => {
    (getEvaluationConfigByDbConfigId as jest.Mock).mockRejectedValue(new Error('not found'));
    const notConfiguredResponse = jest.fn(() => new Response(null, { status: 400 }) as any);

    const result = await loadOfflineEvaluationConfig('db-1', notConfiguredResponse);

    expect('error' in result).toBe(true);
    expect(notConfiguredResponse).toHaveBeenCalledTimes(1);
  });

  it('calls the caller-provided notConfiguredResponse when the config has no id', async () => {
    (getEvaluationConfigByDbConfigId as jest.Mock).mockResolvedValue({});
    const notConfiguredResponse = jest.fn(() => new Response(null, { status: 400 }) as any);

    const result = await loadOfflineEvaluationConfig('db-1', notConfiguredResponse);

    expect('error' in result).toBe(true);
    expect(notConfiguredResponse).toHaveBeenCalledTimes(1);
  });

  it('returns the config when found, without calling notConfiguredResponse', async () => {
    (getEvaluationConfigByDbConfigId as jest.Mock).mockResolvedValue({ id: 'cfg-1' });
    const notConfiguredResponse = jest.fn(() => new Response(null, { status: 400 }) as any);

    const result = await loadOfflineEvaluationConfig('db-1', notConfiguredResponse);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.config.id).toBe('cfg-1');
    }
    expect(notConfiguredResponse).not.toHaveBeenCalled();
    expect(getEvaluationConfigByDbConfigId).toHaveBeenCalledWith('db-1', true);
  });
});

describe('EVALUATION_NOT_CONFIGURED_MESSAGE', () => {
  it('is a non-empty string', () => {
    expect(typeof EVALUATION_NOT_CONFIGURED_MESSAGE).toBe('string');
    expect(EVALUATION_NOT_CONFIGURED_MESSAGE.length).toBeGreaterThan(0);
  });
});
