import {
	getCurrentProject,
	getProjectIsLoading,
	getProjectList,
} from "@/selectors/project";

describe("project selectors", () => {
	it("returns project slice values", () => {
		const state = {
			project: {
				list: [{ id: "project-1" }],
				current: { id: "project-1" },
				isLoading: true,
			},
		} as any;

		expect(getProjectList(state)).toBe(state.project.list);
		expect(getCurrentProject(state)).toBe(state.project.current);
		expect(getProjectIsLoading(state)).toBe(true);
	});
});
