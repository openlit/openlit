const mockSetList = jest.fn();
const mockSetIsLoading = jest.fn();
const mockSetCurrent = jest.fn();
const mockGetData = jest.fn();
const mockPostData = jest.fn();
const mockFetchDatabaseConfigList = jest.fn();
const mockPingActiveDatabaseConfig = jest.fn();
const mockToastError = jest.fn();

const mockState = {
	organisation: {
		current: { id: "org-1" },
	},
	project: {
		list: [
			{
				id: "project-1",
				organisationId: "org-1",
				name: "Project 1",
				slug: "project-1",
				isDefault: true,
				isCurrent: true,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "project-2",
				organisationId: "org-1",
				name: "Project 2",
				slug: "project-2",
				isDefault: false,
				isCurrent: false,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		],
		setList: mockSetList,
		setIsLoading: mockSetIsLoading,
		setCurrent: mockSetCurrent,
	},
};

jest.mock("@/store", () => ({
	useRootStore: {
		getState: jest.fn(() => mockState),
	},
}));

jest.mock("@/utils/api", () => ({
	getData: (...args: unknown[]) => mockGetData(...args),
	postData: (...args: unknown[]) => mockPostData(...args),
}));

jest.mock("sonner", () => ({
	toast: {
		error: (...args: unknown[]) => mockToastError(...args),
	},
}));

jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: () => ({
		PROJECT_SWITCH_FAILED: "Project switch failed",
	}),
}));

jest.mock("@/helpers/client/database-config", () => ({
	fetchDatabaseConfigList: (...args: unknown[]) =>
		mockFetchDatabaseConfigList(...args),
	pingActiveDatabaseConfig: (...args: unknown[]) =>
		mockPingActiveDatabaseConfig(...args),
}));

import { changeActiveProject, fetchProjectList } from "@/helpers/client/project";

describe("project client helpers", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockState.organisation.current = { id: "org-1" };
		mockGetData.mockResolvedValue([]);
		mockPostData.mockResolvedValue({});
		mockFetchDatabaseConfigList.mockResolvedValue([]);
		mockPingActiveDatabaseConfig.mockResolvedValue(null);
	});

	it("sets an empty project list when no organisation is selected", async () => {
		mockState.organisation.current = undefined as any;

		await expect(fetchProjectList()).resolves.toEqual([]);

		expect(mockSetList).toHaveBeenCalledWith([]);
		expect(mockGetData).not.toHaveBeenCalled();
	});

	it("fetches project lists, updates loading, and dedupes in-flight requests", async () => {
		const projects = [mockState.project.list[0]];
		let resolveRequest: (value: unknown) => void = () => {};
		mockGetData.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveRequest = resolve;
			})
		);

		const first = fetchProjectList("org-1");
		const second = fetchProjectList("org-1");
		resolveRequest(projects);

		await expect(first).resolves.toEqual(projects);
		await expect(second).resolves.toEqual(projects);

		expect(mockGetData).toHaveBeenCalledTimes(1);
		expect(mockSetIsLoading).toHaveBeenCalledWith(true);
		expect(mockSetList).toHaveBeenCalledWith(projects);
	});

	it("clears project list when project fetch fails", async () => {
		mockGetData.mockRejectedValueOnce(new Error("network"));

		await expect(fetchProjectList("org-1")).resolves.toEqual([]);

		expect(mockSetIsLoading).toHaveBeenCalledWith(false);
		expect(mockSetList).toHaveBeenCalledWith([]);
	});

	it("switches active project and refreshes database config state", async () => {
		const successCb = jest.fn();

		await changeActiveProject("project-2", successCb);

		expect(mockPostData).toHaveBeenCalledWith({
			url: "/api/organisation/org-1/projects/current/project-2",
			data: {},
		});
		expect(mockSetCurrent).toHaveBeenCalledWith(mockState.project.list[1]);
		expect(mockFetchDatabaseConfigList).toHaveBeenCalledWith(expect.any(Function));
		expect(mockPingActiveDatabaseConfig).toHaveBeenCalled();
		expect(successCb).toHaveBeenCalled();
	});

	it("does not switch project without an organisation", async () => {
		mockState.organisation.current = undefined as any;

		await changeActiveProject("project-2");

		expect(mockPostData).not.toHaveBeenCalled();
	});

	it("shows a toast when switching project fails", async () => {
		mockPostData.mockResolvedValueOnce({ err: "No access" });

		await changeActiveProject("project-2");

		expect(mockToastError).toHaveBeenCalledWith("No access", {
			id: "project-switch",
		});
		expect(mockSetCurrent).not.toHaveBeenCalled();
	});
});
