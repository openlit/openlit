import { renderHook, act } from "@testing-library/react";
import { useSidebarPreferences } from "@/utils/hooks/useSidebarPreferences";

const STORAGE_PREFIX = "openlit:my-apps-hidden:";

describe("useSidebarPreferences", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("starts unloaded with no hidden apps when userId is missing", () => {
		const { result } = renderHook(() => useSidebarPreferences());
		expect(result.current.hidden).toEqual([]);
		expect(result.current.loaded).toBe(false);
	});

	it("loads persisted hidden links for a user", () => {
		window.localStorage.setItem(
			`${STORAGE_PREFIX}user-1`,
			JSON.stringify({ hidden: ["/apps/a", "/apps/b"] })
		);
		const { result } = renderHook(() => useSidebarPreferences("user-1"));
		expect(result.current.loaded).toBe(true);
		expect(result.current.hidden).toEqual(["/apps/a", "/apps/b"]);
	});

	it("treats missing storage as an empty hidden list", () => {
		const { result } = renderHook(() => useSidebarPreferences("user-2"));
		expect(result.current.loaded).toBe(true);
		expect(result.current.hidden).toEqual([]);
	});

	it("ignores corrupted JSON and falls back to an empty list", () => {
		window.localStorage.setItem(`${STORAGE_PREFIX}user-3`, "not-json{{{");
		const { result } = renderHook(() => useSidebarPreferences("user-3"));
		expect(result.current.hidden).toEqual([]);
	});

	it("filters out non-string entries in the persisted hidden array", () => {
		window.localStorage.setItem(
			`${STORAGE_PREFIX}user-4`,
			JSON.stringify({ hidden: ["/apps/a", 42, null, "/apps/b"] })
		);
		const { result } = renderHook(() => useSidebarPreferences("user-4"));
		expect(result.current.hidden).toEqual(["/apps/a", "/apps/b"]);
	});

	it("falls back to an empty list when hidden is not an array", () => {
		window.localStorage.setItem(
			`${STORAGE_PREFIX}user-5`,
			JSON.stringify({ hidden: "not-an-array" })
		);
		const { result } = renderHook(() => useSidebarPreferences("user-5"));
		expect(result.current.hidden).toEqual([]);
	});

	it("hides a link and persists the update", () => {
		const { result } = renderHook(() => useSidebarPreferences("user-6"));
		act(() => {
			result.current.hide("/apps/a");
		});
		expect(result.current.hidden).toEqual(["/apps/a"]);
		expect(result.current.isHidden("/apps/a")).toBe(true);
		expect(
			JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}user-6`) || "{}")
		).toEqual({ hidden: ["/apps/a"] });
	});

	it("hiding an already-hidden link is a no-op", () => {
		const { result } = renderHook(() => useSidebarPreferences("user-7"));
		act(() => {
			result.current.hide("/apps/a");
		});
		act(() => {
			result.current.hide("/apps/a");
		});
		expect(result.current.hidden).toEqual(["/apps/a"]);
	});

	it("shows a previously hidden link", () => {
		const { result } = renderHook(() => useSidebarPreferences("user-8"));
		act(() => {
			result.current.hide("/apps/a");
		});
		act(() => {
			result.current.show("/apps/a");
		});
		expect(result.current.hidden).toEqual([]);
		expect(result.current.isHidden("/apps/a")).toBe(false);
	});

	it("showing a link that is not hidden does not persist a new write", () => {
		const { result } = renderHook(() => useSidebarPreferences("user-9"));
		act(() => {
			result.current.show("/apps/never-hidden");
		});
		expect(result.current.hidden).toEqual([]);
	});

	it("toggle hides a shown link and shows a hidden link", () => {
		const { result } = renderHook(() => useSidebarPreferences("user-10"));
		act(() => {
			result.current.toggle("/apps/a");
		});
		expect(result.current.hidden).toEqual(["/apps/a"]);

		act(() => {
			result.current.toggle("/apps/a");
		});
		expect(result.current.hidden).toEqual([]);
	});

	it("does not persist to storage when there is no userId", () => {
		const { result } = renderHook(() => useSidebarPreferences());
		act(() => {
			result.current.hide("/apps/a");
		});
		expect(result.current.hidden).toEqual(["/apps/a"]);
		expect(window.localStorage.getItem(`${STORAGE_PREFIX}undefined`)).toBeNull();
	});

	it("reloads preferences when the userId changes", () => {
		window.localStorage.setItem(
			`${STORAGE_PREFIX}user-11`,
			JSON.stringify({ hidden: ["/apps/a"] })
		);
		window.localStorage.setItem(
			`${STORAGE_PREFIX}user-12`,
			JSON.stringify({ hidden: ["/apps/b"] })
		);
		const { result, rerender } = renderHook(
			({ userId }: { userId?: string }) => useSidebarPreferences(userId),
			{ initialProps: { userId: "user-11" } }
		);
		expect(result.current.hidden).toEqual(["/apps/a"]);

		rerender({ userId: "user-12" });
		expect(result.current.hidden).toEqual(["/apps/b"]);
	});
});
