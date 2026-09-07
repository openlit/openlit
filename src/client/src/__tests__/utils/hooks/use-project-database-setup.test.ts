/**
 * @jest-environment jsdom
 */

const fetchDatabaseConfigList = jest.fn().mockResolvedValue(undefined);

jest.mock("@/helpers/client/database-config", () => ({
	fetchDatabaseConfigList: (...args: unknown[]) => fetchDatabaseConfigList(...args),
	projectHasDatabaseConfig: (list: unknown[] | undefined | null) =>
		Array.isArray(list) && list.length > 0,
}));

jest.mock("@/store", () => ({
	useRootStore: jest.fn(),
}));

import { renderHook } from "@testing-library/react";
import { useRootStore } from "@/store";
import { useProjectDatabaseSetup } from "@/utils/hooks/use-project-database-setup";

function mockStore(
	overrides: {
		currentProject?: { id: string } | undefined;
		list?: unknown[] | undefined;
		isLoading?: boolean;
	} = {}
) {
	const state = {
		project: {
			current:
				"currentProject" in overrides ? overrides.currentProject : { id: "proj-1" },
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

	it("fetches database configs when a current project is selected", () => {
		mockStore({ list: [] });
		renderHook(() => useProjectDatabaseSetup());
		expect(fetchDatabaseConfigList).toHaveBeenCalled();
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
