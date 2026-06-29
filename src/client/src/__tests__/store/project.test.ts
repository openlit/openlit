import { create } from "zustand";
import { withLenses } from "@dhmk/zustand-lens";
import { projectStoreSlice } from "@/store/project";
import type { ProjectWithMeta } from "@/types/store/project";

const createStore = () => create<any>()(withLenses({ project: projectStoreSlice }));

const project = (
	id: string,
	overrides: Partial<ProjectWithMeta> = {}
): ProjectWithMeta => ({
	id,
	organisationId: "org-1",
	name: `Project ${id}`,
	slug: id,
	isDefault: false,
	isCurrent: false,
	createdAt: "2026-01-01T00:00:00.000Z",
	...overrides,
});

describe("projectStoreSlice", () => {
	let store: ReturnType<typeof createStore>;

	beforeEach(() => {
		store = createStore();
	});

	it("starts with the expected initial state", () => {
		expect(store.getState().project.list).toBeUndefined();
		expect(store.getState().project.current).toBeUndefined();
		expect(store.getState().project.isLoading).toBe(false);
	});

	it("selects current, default, then first project when setting the list", () => {
		const first = project("first");
		const fallback = project("fallback", { isDefault: true });
		const current = project("current", { isCurrent: true });

		store.getState().project.setList([first, fallback, current]);
		expect(store.getState().project.current).toEqual(current);

		store.getState().project.setList([first, fallback]);
		expect(store.getState().project.current).toEqual(fallback);

		store.getState().project.setList([first]);
		expect(store.getState().project.current).toEqual(first);
		expect(store.getState().project.isLoading).toBe(false);
	});

	it("sets the current project and updates list flags", () => {
		const first = project("first", { isCurrent: true });
		const second = project("second");

		store.getState().project.setList([first, second]);
		store.getState().project.setCurrent(second);

		expect(store.getState().project.current).toMatchObject({
			id: "second",
			isCurrent: true,
		});
		expect(store.getState().project.list).toEqual([
			expect.objectContaining({ id: "first", isCurrent: false }),
			expect.objectContaining({ id: "second", isCurrent: true }),
		]);
	});

	it("clears current when setCurrent receives no matching project", () => {
		store.getState().project.setList([project("first")]);
		store.getState().project.setCurrent(undefined);

		expect(store.getState().project.current).toBeUndefined();
		expect(store.getState().project.list).toEqual([
			expect.objectContaining({ id: "first", isCurrent: false }),
		]);
	});

	it("updates loading state and resets the slice", () => {
		store.getState().project.setList([project("first")]);
		store.getState().project.setIsLoading(true);
		expect(store.getState().project.isLoading).toBe(true);

		store.getState().project.reset();
		expect(store.getState().project).toMatchObject({
			list: undefined,
			current: undefined,
			isLoading: false,
		});
	});
});
