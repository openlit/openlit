import { verifyContextInput } from '@/helpers/server/context';

describe('verifyContextInput', () => {
  it('returns error when name is missing', () => {
    expect(verifyContextInput({})).toMatchObject({ success: false, err: expect.any(String) });
  });

  it('returns error when name is only whitespace', () => {
    expect(verifyContextInput({ name: '   ' })).toMatchObject({ success: false });
  });

  it('returns error when content is missing', () => {
    expect(verifyContextInput({ name: 'My Context' })).toMatchObject({ success: false });
  });

  it('returns error when content is only whitespace', () => {
    expect(verifyContextInput({ name: 'My Context', content: '  ' })).toMatchObject({ success: false });
  });

  it('returns error for invalid status', () => {
    expect(
      verifyContextInput({ name: 'My Context', content: 'content', status: 'DELETED' as any })
    ).toMatchObject({ success: false });
  });

  it('returns success for valid minimal input', () => {
    expect(verifyContextInput({ name: 'My Context', content: 'Some context content' })).toEqual({ success: true });
  });

  it('returns success for ACTIVE status', () => {
    expect(verifyContextInput({ name: 'My Context', content: 'content', status: 'ACTIVE' })).toEqual({ success: true });
  });

  it('returns success for INACTIVE status', () => {
    expect(verifyContextInput({ name: 'My Context', content: 'content', status: 'INACTIVE' })).toEqual({ success: true });
  });

  it('returns success with optional fields', () => {
    expect(
      verifyContextInput({
        name: 'My Context',
        content: 'content',
        description: 'A description',
        tags: '["tag1"]',
      })
    ).toEqual({ success: true });
  });
});
