/**
 * @jest-environment jsdom
 */

const fetchDatabaseConfigList = jest.fn(
	async (successCb?: (data: unknown[]) => void) => {
		successCb?.([]);
	}
);
const fetchProjectList = jest.fn().mockResolvedValue([]);
const replace = jest.fn();

jest.mock("next/navigation", () => ({
	useRouter: () => ({ replace, push: jest.fn() }),
	useSearchParams: () => ({ get: () => null }),
}));

jest.mock("@/helpers/client/project", () => ({
	fetchProjectList: (...args: unknown[]) => fetchProjectList(...args),
}));

jest.mock("@/helpers/client/database-config", () => ({
	fetchDatabaseConfigList: (...args: any[]) => fetchDatabaseConfigList(...args),
	projectHasDatabaseConfig: (list: unknown[] | undefined | null) =>
		Array.isArray(list) && list.length > 0,
}));

jest.mock("@/store", () => ({
	useRootStore: jest.fn(),
}));

jest.mock("@/components/(playground)/chat/chat-layout", () => () => null);
jest.mock("@/components/(playground)/request/request-context", () => ({
	RequestProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { render } from "@testing-library/react";
import ChatPage from "@/app/(playground)/chat/page";
import { useRootStore } from "@/store";

const org = { id: "org-1", name: "My cool org", isCurrent: true };
const project = {
	id: "proj-1",
	organisationId: "org-1",
	name: "Default Project",
	isCurrent: true,
};

function mockStore(
	overrides: {
		databaseConfigs?: unknown[] | undefined;
		organisationList?: unknown[] | undefined;
		isOrganisationLoading?: boolean;
		projects?: unknown[] | undefined;
		currentOrg?: typeof org | undefined;
	} = {}
) {
	const currentOrg = "currentOrg" in overrides ? overrides.currentOrg : org;
	const projects =
		"projects" in overrides ? overrides.projects : [project];
	const state = {
		organisation: {
			current: currentOrg,
			list:
				"organisationList" in overrides ? overrides.organisationList : [org],
			isLoading: overrides.isOrganisationLoading ?? false,
		},
		project: {
			list: projects,
			current: Array.isArray(projects) && projects.length > 0 ? project : undefined,
			isLoading: false,
		},
		databaseConfig: {
			list: "databaseConfigs" in overrides ? overrides.databaseConfigs : [],
			isLoading: false,
		},
	};
	(useRootStore as unknown as jest.Mock).mockImplementation((selector) =>
		selector(state)
	);
}

describe("ChatPage database setup gate", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		fetchDatabaseConfigList.mockImplementation(
			async (successCb?: (data: unknown[]) => void) => {
				successCb?.([]);
			}
		);
		global.fetch = jest.fn() as unknown as typeof fetch;
	});

	it("loads project database configs instead of /api/connectors and stays on chat when none exist", async () => {
		mockStore({ databaseConfigs: [] });
		render(<ChatPage />);

		expect(fetchDatabaseConfigList).toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("does not bounce to onboarding while organisation or database configs are still loading", () => {
		fetchDatabaseConfigList.mockImplementation(async () => undefined);
		mockStore({
			databaseConfigs: undefined,
			organisationList: undefined,
			isOrganisationLoading: true,
			currentOrg: undefined,
			projects: undefined,
		});
		render(<ChatPage />);

		expect(replace).not.toHaveBeenCalled();
	});
});
