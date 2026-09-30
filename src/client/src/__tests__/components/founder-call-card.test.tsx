import { fireEvent, render, screen } from "@testing-library/react";
import FounderCallCard, {
	FOUNDER_CARD_DISMISSED_KEY,
	hasPaidFeatureAccess,
} from "@/components/(playground)/sidebar/founder-call-card";
import getMessage from "@/constants/messages";
import { CLIENT_EVENTS } from "@/constants/events";

const mockAccess = {
	accessByAccountId: {} as Record<string, Record<string, boolean>>,
	selectedAccountId: "",
};
let mockExpanded = true;

const mockCapture = jest.fn();
jest.mock("posthog-js/react", () => ({
	usePostHog: () => ({ capture: mockCapture }),
}));

jest.mock("@/components/enterprise-feature-access-provider", () => ({
	useEnterpriseFeatureAccess: () => mockAccess,
}));

jest.mock("@/components/(playground)/sidebar-layout-context", () => ({
	useSidebarLayout: () => ({ isExpanded: mockExpanded }),
}));

const m = getMessage();

describe("hasPaidFeatureAccess", () => {
	it("is false with no access entries", () => {
		expect(hasPaidFeatureAccess({}, "")).toBe(false);
		expect(hasPaidFeatureAccess({ org: { a: false } }, "org")).toBe(false);
	});

	it("is true when the selected account has any granted feature", () => {
		expect(hasPaidFeatureAccess({ org: { a: false, b: true } }, "org")).toBe(true);
		expect(hasPaidFeatureAccess({ org: { a: true } }, "other")).toBe(false);
	});
});

describe("FounderCallCard", () => {
	beforeEach(() => {
		window.localStorage.clear();
		mockAccess.accessByAccountId = {};
		mockAccess.selectedAccountId = "";
		mockExpanded = true;
	});

	it("renders when no license is applied", () => {
		render(<FounderCallCard />);
		expect(screen.getByText(m.FOUNDER_CARD_BADGE)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: new RegExp(m.FOUNDER_CARD_CTA) })).toHaveAttribute(
			"target",
			"_blank"
		);
	});

	it("captures an event when the schedule call link is clicked", () => {
		mockCapture.mockClear();
		render(<FounderCallCard />);
		fireEvent.click(screen.getByRole("link", { name: new RegExp(m.FOUNDER_CARD_CTA) }));
		expect(mockCapture).toHaveBeenCalledWith(CLIENT_EVENTS.FOUNDER_CALL_SCHEDULE_CLICKED);
	});

	it("is hidden when the selected organisation has a paid feature", () => {
		mockAccess.accessByAccountId = { org: { feature: true } };
		mockAccess.selectedAccountId = "org";
		render(<FounderCallCard />);
		expect(screen.queryByText(m.FOUNDER_CARD_BADGE)).not.toBeInTheDocument();
	});

	it("is hidden when the sidebar is collapsed", () => {
		mockExpanded = false;
		render(<FounderCallCard />);
		expect(screen.queryByText(m.FOUNDER_CARD_BADGE)).not.toBeInTheDocument();
	});

	it("dismisses and stays dismissed", () => {
		const { unmount } = render(<FounderCallCard />);
		fireEvent.click(screen.getByRole("button", { name: m.FOUNDER_CARD_DISMISS }));
		expect(screen.queryByText(m.FOUNDER_CARD_BADGE)).not.toBeInTheDocument();
		expect(window.localStorage.getItem(FOUNDER_CARD_DISMISSED_KEY)).not.toBeNull();
		unmount();
		render(<FounderCallCard />);
		expect(screen.queryByText(m.FOUNDER_CARD_BADGE)).not.toBeInTheDocument();
	});

	it("shows again after the dismissal window expires", () => {
		window.localStorage.setItem(
			FOUNDER_CARD_DISMISSED_KEY,
			String(Date.now() - 31 * 24 * 60 * 60 * 1000)
		);
		render(<FounderCallCard />);
		expect(screen.getByText(m.FOUNDER_CARD_BADGE)).toBeInTheDocument();
	});
});
