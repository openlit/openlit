/** @jest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import GettingStarted from "@/app/(playground)/getting-started/page";

jest.mock("posthog-js/react", () => ({ usePostHog: () => ({ capture: jest.fn() }) }));
jest.mock("@/components/common/code-block", () => ({
	__esModule: true,
	default: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

describe("Python first-run content capture notice", () => {
	it("warns beside the first init example and offers an opt-out", () => {
		render(<GettingStarted />);
		const notice = screen.getByRole("note");
		expect(within(notice).getByText(/captures full prompts and responses by default/)).toBeInTheDocument();
		expect(within(notice).getByText(/capture_message_content=False/)).toBeInTheDocument();
		expect(within(notice).getByText(/does not guarantee response content is redacted/)).toBeInTheDocument();
	});
});
