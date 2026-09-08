/**
 * @jest-environment jsdom
 */

const fetchDatabaseConfigList = jest.fn(
	async (successCb?: (data: unknown[]) => void) => {
		successCb?.([]);
	}
);
const replace = jest.fn();
const fireRequest = jest.fn().mockResolvedValue({ response: {}, error: undefined });

jest.mock("next/navigation", () => ({
	useRouter: () => ({ replace, push: jest.fn() }),
	useSearchParams: () => ({ get: () => null }),
}));

jest.mock("posthog-js/react", () => ({
	usePostHog: () => ({ capture: jest.fn() }),
}));

jest.mock("@/selectors/page", () => ({
	usePageHeader: () => ({ setHeader: jest.fn() }),
}));

jest.mock("@/utils/hooks/useFetchWrapper", () => () => ({
	fireRequest,
	isLoading: false,
}));

jest.mock("@/helpers/client/filter", () => ({
	getFilterParamsForDashboard: () => ({}),
}));

jest.mock("@/helpers/client/database-config", () => ({
	fetchDatabaseConfigList: (...args: any[]) => fetchDatabaseConfigList(...args),
	projectHasDatabaseConfig: (list: unknown[] | undefined | null) =>
		Array.isArray(list) && list.length > 0,
}));

jest.mock("@/store", () => ({
	useRootStore: jest.fn(),
}));

jest.mock("../../components/(playground)/filter", () => () => null);
jest.mock("../../app/(playground)/home/board-list", () => () => null);
jest.mock("../../components/(playground)/manage-dashboard/board-creator", () => ({
	__esModule: true,
	default: () => null,
}));

import { render, waitFor } from "@testing-library/react";
import HomePage from "@/app/(playground)/home/page";
import { useRootStore } from "@/store";

const org = { id: "org-1", name: "My cool org", isCurrent: true };
const project = {
	id: "proj-1",
	organisationId: "org-1",
	name: "Default Project",
	isCurrent: true,
};

function mockStore(
	overrides: { databaseConfigs?: unknown[] | undefined } = {}
) {
	const state = {
		organisation: { current: org },
		project: { list: [project], current: project, isLoading: false },
		databaseConfig: {
			list: "databaseConfigs" in overrides ? overrides.databaseConfigs : [],
			isLoading: false,
		},
		filter: { details: {} },
	};
	(useRootStore as unknown as jest.Mock).mockImplementation((selector) =>
		selector(state)
	);
}

describe("HomePage database setup gate", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		fetchDatabaseConfigList.mockImplementation(
			async (successCb?: (data: unknown[]) => void) => {
				successCb?.([]);
			}
		);
		global.fetch = jest.fn() as unknown as typeof fetch;
	});

	it("loads project database configs instead of /api/connectors and redirects when none exist", async () => {
		mockStore({ databaseConfigs: [] });
		render(<HomePage />);

		expect(fetchDatabaseConfigList).toHaveBeenCalled();
		await waitFor(() => {
			expect(replace).toHaveBeenCalledWith("/onboarding");
		});
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("does not bounce to onboarding while database configs are still loading", () => {
		fetchDatabaseConfigList.mockImplementation(async () => undefined);
		mockStore({ databaseConfigs: undefined });
		render(<HomePage />);

		expect(fetchDatabaseConfigList).toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
	});

	it("stays on home once the current project has a database config", async () => {
		mockStore({ databaseConfigs: [{ id: "db-1" }] });
		render(<HomePage />);

		await waitFor(() => {
			expect(fireRequest).toHaveBeenCalled();
		});
		expect(replace).not.toHaveBeenCalled();
	});
});
