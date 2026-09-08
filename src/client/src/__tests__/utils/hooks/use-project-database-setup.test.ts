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

import { renderHook, waitFor } from "@testing-library/react";
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
		fetchDatabaseConfigList.mockImplementation(
			async (successCb?: (data: unknown[]) => void) => {
				successCb?.([]);
			}
		);
	});

	it("fetches database configs for the current project", async () => {
		mockStore({ list: [] });
		renderHook(() => useProjectDatabaseSetup());
		await waitFor(() => {
			expect(fetchDatabaseConfigList).toHaveBeenCalledWith(expect.any(Function), {
				projectId: "proj-1",
			});
		});
	});

	it("does not fetch when there is no current project", () => {
		mockStore({ currentProject: undefined, list: undefined });
		renderHook(() => useProjectDatabaseSetup());
		expect(fetchDatabaseConfigList).not.toHaveBeenCalled();
	});

	it("treats an empty list as incomplete setup once the project list has loaded", async () => {
		mockStore({ list: [] });
		const { result } = renderHook(() => useProjectDatabaseSetup());
		await waitFor(() => {
			expect(result.current.hasDbConfig).toBe(false);
			expect(result.current.isDatabaseSetupLoading).toBe(false);
		});
	});

	it("treats a populated list as complete setup once the project list has loaded", async () => {
		mockStore({ list: [{ id: "db-1" }] });
		const { result } = renderHook(() => useProjectDatabaseSetup());
		await waitFor(() => {
			expect(result.current.hasDbConfig).toBe(true);
		});
	});

	it("keeps setup loading until the current project's configs have loaded", () => {
		fetchDatabaseConfigList.mockImplementation(async () => undefined);
		mockStore({ list: [{ id: "db-from-previous-project" }], isLoading: false });
		const { result } = renderHook(() => useProjectDatabaseSetup());
		expect(result.current.hasDbConfig).toBe(false);
		expect(result.current.isDatabaseSetupLoading).toBe(true);
	});
});
