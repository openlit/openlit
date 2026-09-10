/**
 * @jest-environment jsdom
 */

const fetchDatabaseConfigList = jest.fn().mockResolvedValue(undefined);

jest.mock("@/helpers/client/database-config", () => ({
	fetchDatabaseConfigList: (...args: any[]) => fetchDatabaseConfigList(...args),
	projectHasDatabaseConfig: (list: unknown[] | undefined | null) =>
		Array.isArray(list) && list.length > 0,
}));

jest.mock("@/store", () => ({
	useRootStore: jest.fn(),
}));

import { renderHook } from "@testing-library/react";
import { useRootStore } from "@/store";
import {
	useProjectDatabaseSetup,
	useWorkspaceSetup,
} from "@/utils/hooks/use-project-database-setup";

function mockStore(
	overrides: {
		currentOrg?: { id: string } | undefined;
		organisationList?: unknown[] | undefined;
		isOrganisationLoading?: boolean;
		currentProject?: { id: string } | undefined;
		projects?: unknown[] | undefined;
		isProjectLoading?: boolean;
		list?: unknown[] | undefined;
		isLoading?: boolean;
	} = {}
) {
	const state = {
		organisation: {
			current:
				"currentOrg" in overrides ? overrides.currentOrg : { id: "org-1" },
			list:
				"organisationList" in overrides
					? overrides.organisationList
					: [{ id: "org-1" }],
			isLoading: overrides.isOrganisationLoading ?? false,
		},
		project: {
			current:
				"currentProject" in overrides ? overrides.currentProject : { id: "proj-1" },
			list:
				"projects" in overrides
					? overrides.projects
					: [{ id: "proj-1" }],
			isLoading: overrides.isProjectLoading ?? false,
		},
		databaseConfig: {
			list: overrides.list,
			isLoading: overrides.isLoading ?? false,
		},
	};
	(useRootStore as unknown as jest.Mock).mockImplementation((selector) =>
		selector(state)
	);
}

describe("useProjectDatabaseSetup", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("fetches database configs for the current project", () => {
		mockStore({ list: [] });
		renderHook(() => useProjectDatabaseSetup());
		expect(fetchDatabaseConfigList).toHaveBeenCalledWith(expect.any(Function), {
			projectId: "proj-1",
		});
	});

	it("does not fetch when there is no current project", () => {
		mockStore({ currentProject: undefined, list: undefined });
		renderHook(() => useProjectDatabaseSetup());
		expect(fetchDatabaseConfigList).not.toHaveBeenCalled();
	});

	it("treats an empty list as incomplete setup", () => {
		mockStore({ list: [] });
		const { result } = renderHook(() => useProjectDatabaseSetup());
		expect(result.current.hasDbConfig).toBe(false);
		expect(result.current.isDatabaseSetupLoading).toBe(false);
	});

	it("treats a populated list as complete setup", () => {
		mockStore({ list: [{ id: "db-1" }] });
		const { result } = renderHook(() => useProjectDatabaseSetup());
		expect(result.current.hasDbConfig).toBe(true);
	});

	it("keeps setup loading while the project config list is still undefined", () => {
		mockStore({ list: undefined, isLoading: false });
		const { result } = renderHook(() => useProjectDatabaseSetup());
		expect(result.current.isDatabaseSetupLoading).toBe(true);
		expect(result.current.hasDbConfig).toBe(false);
	});
});

describe("useWorkspaceSetup", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("stays loading while organisation list has not hydrated", () => {
		mockStore({
			organisationList: undefined,
			isOrganisationLoading: false,
			currentOrg: undefined,
			currentProject: undefined,
			projects: undefined,
			list: undefined,
		});
		const { result } = renderHook(() => useWorkspaceSetup());
		expect(result.current.isSetupLoading).toBe(true);
	});

	it("stays loading while the current organisation's projects are still undefined", () => {
		mockStore({
			projects: undefined,
			list: [{ id: "db-1" }],
		});
		const { result } = renderHook(() => useWorkspaceSetup());
		expect(result.current.isSetupLoading).toBe(true);
	});

	it("is ready once organisation, project, and database config lists have loaded", () => {
		mockStore({ list: [{ id: "db-1" }] });
		const { result } = renderHook(() => useWorkspaceSetup());
		expect(result.current.isSetupLoading).toBe(false);
		expect(result.current.hasDbConfig).toBe(true);
		expect(result.current.hasProject).toBe(true);
	});
});
