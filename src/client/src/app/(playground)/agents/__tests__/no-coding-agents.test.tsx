import { fireEvent, render, screen, within } from "@testing-library/react";
import NoCodingAgents from "@/app/(playground)/agents/no-coding-agents";

jest.mock("@/selectors/database-config", () => ({
	getPingStatus: jest.fn(),
}));

jest.mock("@/store", () => ({
	useRootStore: jest.fn(() => "success"),
}));

jest.mock("@/utils/hooks/useFetchWrapper", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		data: [{ apiKey: "test-api-key" }],
		fireRequest: jest.fn(),
		isLoading: false,
	})),
}));

describe("NoCodingAgents OpenCode onboarding", () => {
	it("shows the OpenCode install command, restart, and first-session steps", () => {
		render(<NoCodingAgents compact />);

		fireEvent.click(screen.getByRole("button", { name: /OpenCode/ }));

		expect(
			screen.getByText(/openlit coding install --vendor=opencode/),
		).toBeInTheDocument();

		const postInstall = screen
			.getByText("After running the snippet")
			.closest("div");
		expect(postInstall).not.toBeNull();
		const steps = within(postInstall as HTMLElement).getAllByRole("listitem");
		expect(steps).toHaveLength(2);
		expect(steps[0]).toHaveTextContent("Restart OpenCode.");
		expect(steps[1]).toHaveTextContent("Send any prompt in OpenCode.");
	});
});
