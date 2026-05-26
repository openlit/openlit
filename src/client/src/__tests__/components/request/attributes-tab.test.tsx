import { render, screen } from '@testing-library/react';
import { AttrRow } from '@/components/(playground)/request/components/attributes-tab';

describe('AttrRow', () => {
  it('preserves newlines in trace text values', () => {
    render(<AttrRow label="Prompt" value={'first line\nsecond line'} mono />);

    const value = screen.getByText(/first line/);

    expect(value.textContent).toBe('first line\nsecond line');
    expect(value).toHaveClass('whitespace-pre-wrap');
    expect(value).toHaveClass('break-all');
    expect(value).toHaveClass('font-mono');
  });

  it('keeps word wrapping readable for non-mono text', () => {
    render(<AttrRow label="Summary" value="first line\nsecond line" />);

    const value = screen.getByText(/first line/);

    expect(value).toHaveClass('whitespace-pre-wrap');
    expect(value).toHaveClass('break-words');
    expect(value).not.toHaveClass('font-mono');
  });
});
