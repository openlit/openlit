import { buildHierarchy } from '@/helpers/server/trace';

describe('buildHierarchy', () => {
  it('returns null for an empty array', () => {
    expect(buildHierarchy([])).toBeNull();
  });

  it('returns a single root span with no children', () => {
    const data = [{ SpanId: 'root', ParentSpanId: '', name: 'root-span' }];
    const result = buildHierarchy(data);
    expect(result).not.toBeNull();
    expect(result.SpanId).toBe('root');
    expect(result.children).toHaveLength(0);
  });

  it('builds a parent-child hierarchy', () => {
    const data = [
      { SpanId: 'root', ParentSpanId: '' },
      { SpanId: 'child1', ParentSpanId: 'root' },
      { SpanId: 'child2', ParentSpanId: 'root' },
    ];
    const result = buildHierarchy(data);
    expect(result.SpanId).toBe('root');
    expect(result.children).toHaveLength(2);
    const childIds = result.children.map((c: any) => c.SpanId);
    expect(childIds).toContain('child1');
    expect(childIds).toContain('child2');
  });

  it('builds a multi-level hierarchy', () => {
    const data = [
      { SpanId: 'root', ParentSpanId: '' },
      { SpanId: 'child', ParentSpanId: 'root' },
      { SpanId: 'grandchild', ParentSpanId: 'child' },
    ];
    const result = buildHierarchy(data);
    expect(result.SpanId).toBe('root');
    expect(result.children[0].SpanId).toBe('child');
    expect(result.children[0].children[0].SpanId).toBe('grandchild');
  });

  it('preserves span properties in the hierarchy', () => {
    const data = [
      { SpanId: 'root', ParentSpanId: '', Duration: 100, ServiceName: 'api' },
      { SpanId: 'child', ParentSpanId: 'root', Duration: 50, ServiceName: 'db' },
    ];
    const result = buildHierarchy(data);
    expect(result.Duration).toBe(100);
    expect(result.children[0].Duration).toBe(50);
  });

  it('handles spans with unknown parents gracefully', () => {
    const data = [
      { SpanId: 'root', ParentSpanId: '' },
      { SpanId: 'orphan', ParentSpanId: 'nonexistent-parent' },
    ];
    const result = buildHierarchy(data);
    expect(result.SpanId).toBe('root');
    expect(result.children).toHaveLength(0);
  });

  it('identifies root by empty ParentSpanId', () => {
    const data = [
      { SpanId: 'child', ParentSpanId: 'root' },
      { SpanId: 'root', ParentSpanId: '' },
    ];
    const result = buildHierarchy(data);
    expect(result.SpanId).toBe('root');
  });
});
