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

import { render, waitFor } from "@testing-library/react";
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
	overrides: { databaseConfigs?: unknown[] | undefined } = {}
) {
	const state = {
		organisation: { current: org },
		project: { list: [project], current: project, isLoading: false },
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

	it("loads project database configs instead of /api/connectors and redirects when none exist", async () => {
		mockStore({ databaseConfigs: [] });
		render(<ChatPage />);

		expect(fetchDatabaseConfigList).toHaveBeenCalled();
		await waitFor(() => {
			expect(replace).toHaveBeenCalledWith("/onboarding");
		});
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("does not bounce to onboarding while database configs are still loading", () => {
		fetchDatabaseConfigList.mockImplementation(async () => undefined);
		mockStore({ databaseConfigs: undefined });
		render(<ChatPage />);

		expect(replace).not.toHaveBeenCalled();
	});
});
