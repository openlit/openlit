import { getAttributeValue } from '@/helpers/client/fleet-hub';

const makeAgent = (attributes: { key: string; value: any }[]) => ({
  identityAttributes: attributes,
});

describe('getAttributeValue', () => {
  it('returns the StringValue for a matching attribute key', () => {
    const agent = makeAgent([
      { key: 'service.name', value: { Value: { StringValue: 'my-service' } } },
      { key: 'host.arch', value: { Value: { StringValue: 'amd64' } } },
    ]);
    const result = getAttributeValue(agent as any, 'identityAttributes', 'service.name');
    expect(result).toBe('my-service');
  });

  it('returns the default value when key is not found', () => {
    const agent = makeAgent([
      { key: 'host.arch', value: { Value: { StringValue: 'amd64' } } },
    ]);
    const result = getAttributeValue(agent as any, 'identityAttributes', 'missing.key');
    expect(result).toBe('N/A');
  });

  it('uses a custom default value when key is not found', () => {
    const agent = makeAgent([]);
    const result = getAttributeValue(
      agent as any,
      'identityAttributes',
      'missing.key',
      'unknown'
    );
    expect(result).toBe('unknown');
  });

  it('returns value from the correct nested path', () => {
    const agent = {
      customPath: [{ key: 'env', value: { Value: { StringValue: 'production' } } }],
    };
    const result = getAttributeValue(agent as any, 'customPath', 'env');
    expect(result).toBe('production');
  });
});
