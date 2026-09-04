/**
 * @jest-environment jsdom
 */

const fetchOrganisationList = jest.fn().mockResolvedValue(undefined);
const fetchPendingInvitations = jest.fn().mockResolvedValue(undefined);
const fetchProjectList = jest.fn().mockResolvedValue([]);
const fetchDatabaseConfigList = jest.fn().mockResolvedValue(undefined);

jest.mock("next-auth/react", () => ({
	useSession: () => ({ update: jest.fn() }),
}));

jest.mock("posthog-js/react", () => ({
	usePostHog: () => ({ capture: jest.fn(), group: jest.fn() }),
}));

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

jest.mock("@/helpers/client/organisation", () => ({
	fetchOrganisationList: (...args: unknown[]) => fetchOrganisationList(...args),
	fetchPendingInvitations: (...args: unknown[]) => fetchPendingInvitations(...args),
	acceptInvitation: jest.fn(),
	declineInvitation: jest.fn(),
}));

jest.mock("@/helpers/client/project", () => ({
	fetchProjectList: (...args: unknown[]) => fetchProjectList(...args),
}));

jest.mock("@/helpers/client/database-config", () => ({
	fetchDatabaseConfigList: (...args: unknown[]) => fetchDatabaseConfigList(...args),
	deleteDatabaseConfig: jest.fn(),
}));

jest.mock("@/store", () => ({
	useRootStore: jest.fn(),
}));

import { fireEvent, render, screen } from "@testing-library/react";
import OnboardingPage from "@/app/(playground)/onboarding/page";
import { useRootStore } from "@/store";

const org = { id: "org-1", name: "My cool org", isCurrent: true, memberCount: 1 };
const project = {
	id: "proj-1",
	organisationId: "org-1",
	name: "Default Project",
	slug: "default",
	isDefault: true,
	isCurrent: true,
	createdAt: "2026-01-01T00:00:00.000Z",
};

function mockStore({
	databaseConfigs = [] as unknown[],
}: { databaseConfigs?: unknown[] } = {}) {
	const state = {
		organisation: {
			pendingInvitations: [],
			list: [org],
			current: org,
			isLoading: false,
		},
		project: {
			list: [project],
			current: project,
			currentEnvironment: "production",
			isLoading: false,
		},
		databaseConfig: {
			list: databaseConfigs,
			isLoading: false,
		},
	};
	(useRootStore as unknown as jest.Mock).mockImplementation((selector) =>
		selector(state)
	);
}

describe("OnboardingPage database config step", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockStore();
		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ environments: [] }),
		}) as unknown as typeof fetch;
	});

	it("renders an Add database config control on step 3 instead of a dead connectors link", () => {
		render(<OnboardingPage />);

		expect(
			screen.getByRole("button", { name: "Add database config" })
		).toBeInTheDocument();
		expect(
			screen.getByText("You have not created any database config")
		).toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: /Add New Config/i })
		).not.toBeInTheDocument();
	});

	it("opens the ClickHouse config form from step 3", () => {
		render(<OnboardingPage />);

		fireEvent.click(screen.getByRole("button", { name: "Add database config" }));

		expect(screen.getByText("Add ClickHouse connector")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("127.0.0.1")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("8123")).toBeInTheDocument();
	});
});
