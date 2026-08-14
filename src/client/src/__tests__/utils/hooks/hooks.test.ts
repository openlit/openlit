jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/'),
}));
jest.mock('@/selectors/page', () => ({
  usePageHeader: jest.fn(),
}));
jest.mock('@/utils/breadcrumbs', () => ({
  generatePageHeader: jest.fn((pathname: string) => ({ title: `Page ${pathname}`, breadcrumbs: [] })),
  updatePageHeaderWithData: jest.fn(
    (base: any, data: any) => ({ ...base, ...data })
  ),
}));
jest.mock('@/utils/api', () => ({
  getData: jest.fn(),
}));
jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}));
jest.mock('tiny-cookie', () => ({
  get: jest.fn(),
  set: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { usePageHeader } from '@/selectors/page';
import { generatePageHeader, updatePageHeaderWithData } from '@/utils/breadcrumbs';
import { getData } from '@/utils/api';
import { toast } from 'sonner';
import { get as cookieGet, set as cookieSet } from 'tiny-cookie';
import { useBreadcrumbs, useDynamicBreadcrumbs, useCustomBreadcrumbs } from '@/utils/hooks/useBreadcrumbs';
import useClickhousePing from '@/utils/hooks/useClickhousePing';
import useTheme from '@/utils/hooks/useTheme';

// ----------------------------------------------------------------
// useBreadcrumbs
// ----------------------------------------------------------------
describe('useBreadcrumbs', () => {
  const mockSetHeader = jest.fn();
  const mockHeader = { title: 'Home', breadcrumbs: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    (usePageHeader as jest.Mock).mockReturnValue({ header: mockHeader, setHeader: mockSetHeader });
    (usePathname as jest.Mock).mockReturnValue('/dashboard');
  });

  it('calls generatePageHeader with current pathname', () => {
    renderHook(() => useBreadcrumbs());
    expect(generatePageHeader).toHaveBeenCalledWith('/dashboard');
  });

  it('calls setHeader with generated page header', () => {
    renderHook(() => useBreadcrumbs());
    expect(mockSetHeader).toHaveBeenCalledWith({ title: 'Page /dashboard', breadcrumbs: [] });
  });

  it('returns header and setHeader from usePageHeader', () => {
    const { result } = renderHook(() => useBreadcrumbs());
    expect(result.current.header).toBe(mockHeader);
    expect(result.current.setHeader).toBe(mockSetHeader);
  });

  it('re-runs effect when pathname changes', () => {
    (usePathname as jest.Mock).mockReturnValue('/settings');
    renderHook(() => useBreadcrumbs());
    expect(generatePageHeader).toHaveBeenCalledWith('/settings');
  });
});

describe('useDynamicBreadcrumbs', () => {
  const mockSetHeader = jest.fn();
  const mockHeader = { title: 'Page /', breadcrumbs: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    (usePageHeader as jest.Mock).mockReturnValue({ header: mockHeader, setHeader: mockSetHeader });
    (usePathname as jest.Mock).mockReturnValue('/requests');
  });

  it('calls generatePageHeader and then updatePageHeaderWithData', () => {
    renderHook(() => useDynamicBreadcrumbs({ title: 'Custom Title' }));
    expect(generatePageHeader).toHaveBeenCalledWith('/requests');
    expect(updatePageHeaderWithData).toHaveBeenCalledWith(
      { title: 'Page /requests', breadcrumbs: [] },
      { title: 'Custom Title' }
    );
  });

  it('calls setHeader with the updated header', () => {
    renderHook(() => useDynamicBreadcrumbs({ title: 'Dynamic', description: 'desc' }));
    expect(mockSetHeader).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dynamic' })
    );
  });

  it('returns header and setHeader', () => {
    const { result } = renderHook(() => useDynamicBreadcrumbs({}));
    expect(result.current.header).toBe(mockHeader);
    expect(result.current.setHeader).toBe(mockSetHeader);
  });
});

describe('useCustomBreadcrumbs', () => {
  const mockSetHeader = jest.fn();
  const mockHeader = { title: 'Home', breadcrumbs: [] };
  const customHeader = { title: 'Custom', description: 'My page', breadcrumbs: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    (usePageHeader as jest.Mock).mockReturnValue({ header: mockHeader, setHeader: mockSetHeader });
  });

  it('calls setHeader with the custom header', () => {
    renderHook(() => useCustomBreadcrumbs(customHeader));
    expect(mockSetHeader).toHaveBeenCalledWith(customHeader);
  });

  it('returns header and setHeader from usePageHeader', () => {
    const { result } = renderHook(() => useCustomBreadcrumbs(customHeader));
    expect(result.current.header).toBe(mockHeader);
    expect(result.current.setHeader).toBe(mockSetHeader);
  });
});

// ----------------------------------------------------------------
// useClickhousePing
// ----------------------------------------------------------------
describe('useClickhousePing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets isSuccess=true on successful ping', async () => {
    (getData as jest.Mock).mockResolvedValue({ err: null });
    const { result } = renderHook(() => useClickhousePing());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('sets error when response has err', async () => {
    (getData as jest.Mock).mockResolvedValue({ err: 'Connection refused' });
    const { result } = renderHook(() => useClickhousePing());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toBe('Connection refused');
    expect(toast.error).toHaveBeenCalledWith('Connection refused', { id: 'PING' });
    expect(result.current.isLoading).toBe(false);
  });

  it('sets error when getData throws', async () => {
    (getData as jest.Mock).mockRejectedValue(new Error('Network failure'));
    const { result } = renderHook(() => useClickhousePing());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toContain('Network failure');
    expect(result.current.isLoading).toBe(false);
  });

  it('starts with isLoading=true', () => {
    (getData as jest.Mock).mockResolvedValue(new Promise(() => {}));
    const { result } = renderHook(() => useClickhousePing());
    expect(result.current.isLoading).toBe(true);
  });
});

// ----------------------------------------------------------------
// useTheme
// ----------------------------------------------------------------
describe('useTheme', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (cookieGet as jest.Mock).mockReturnValue('light');
    document.documentElement.classList.remove('dark', 'light');
  });

  it('initializes theme from cookie', async () => {
    (cookieGet as jest.Mock).mockReturnValue('dark');
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(result.current.theme).toBe('dark');
  });

  it('toggles from light to dark', async () => {
    (cookieGet as jest.Mock).mockReturnValue('light');
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Update cookie mock so effect re-read returns the toggled value
    (cookieGet as jest.Mock).mockReturnValue('dark');
    await act(async () => {
      result.current.toggleTheme();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(cookieSet).toHaveBeenCalledWith('theme', 'dark');
    expect(result.current.theme).toBe('dark');
  });

  it('toggles to specific theme when parameter provided', async () => {
    (cookieGet as jest.Mock).mockReturnValue('light');
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Update cookie mock so effect re-read returns the toggled value
    (cookieGet as jest.Mock).mockReturnValue('dark');
    await act(async () => {
      result.current.toggleTheme('dark');
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(cookieSet).toHaveBeenCalledWith('theme', 'dark');
    expect(result.current.theme).toBe('dark');
  });

  it('updates document classList when toggling', async () => {
    (cookieGet as jest.Mock).mockReturnValue('light');
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('returns toggleTheme function', () => {
    const { result } = renderHook(() => useTheme());
    expect(typeof result.current.toggleTheme).toBe('function');
  });

  it('toggles from dark to light (covers dark branch)', async () => {
    (cookieGet as jest.Mock).mockReturnValue('dark');
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    (cookieGet as jest.Mock).mockReturnValue('light');
    await act(async () => {
      result.current.toggleTheme();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(cookieSet).toHaveBeenCalledWith('theme', 'light');
    expect(result.current.theme).toBe('light');
  });
});
