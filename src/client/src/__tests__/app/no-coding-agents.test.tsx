import { fireEvent, render, screen } from "@testing-library/react";
import NoCodingAgents from "@/app/(playground)/agents/no-coding-agents";
import {
	AGENTS_CODING_VENDOR_HERMES_GUIDE,
	AGENTS_CODING_VENDOR_HERMES_LABEL,
	AGENTS_CODING_VENDOR_HERMES_RESTART,
	AGENTS_CODING_VENDOR_HERMES_WHERE,
} from "@/constants/messages/en";

const mockApiKeys: { current: { apiKey: string }[] | undefined } = {
	current: undefined,
};

jest.mock("@/utils/hooks/useFetchWrapper", () => () => ({
	data: mockApiKeys.current,
	fireRequest: jest.fn(),
	isLoading: false,
}));

jest.mock("@/store", () => ({
	useRootStore: () => "success",
}));

jest.mock("sonner", () => ({
	toast: { loading: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

const snippetText = () => document.querySelector("pre")?.textContent || "";

describe("NoCodingAgents", () => {
	beforeEach(() => {
		mockApiKeys.current = [{ apiKey: "openlit-test-key" }];
	});

	it("shows a Hermes snippet that installs the plugin and writes the endpoint and key", () => {
		render(<NoCodingAgents compact />);

		fireEvent.click(screen.getByRole("button", { name: "macOS" }));
		fireEvent.click(screen.getByRole("button", { name: AGENTS_CODING_VENDOR_HERMES_LABEL }));

		const endpoint = new URL(window.location.origin);
		endpoint.port = "4318";
		expect(snippetText()).toBe(
			[
				"hermes plugins install openlit/openlit/plugins/hermes --enable",
				`hermes config set OTEL_EXPORTER_OTLP_ENDPOINT "${endpoint.origin}"`,
				'hermes config set OPENLIT_API_KEY "openlit-test-key"',
			].join(" && ")
		);
		expect(snippetText()).not.toContain("openlit coding install");
		expect(screen.getByText(AGENTS_CODING_VENDOR_HERMES_RESTART)).toBeInTheDocument();
		expect(screen.getByText(AGENTS_CODING_VENDOR_HERMES_WHERE)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: AGENTS_CODING_VENDOR_HERMES_GUIDE })
		).toHaveAttribute(
			"href",
			"https://docs.openlit.io/latest/openlit/observability/agents/hermes"
		);
	});

	it("uses the PowerShell separator for Hermes on Windows", () => {
		render(<NoCodingAgents compact />);

		fireEvent.click(screen.getByRole("button", { name: "Windows" }));
		fireEvent.click(screen.getByRole("button", { name: AGENTS_CODING_VENDOR_HERMES_LABEL }));

		expect(snippetText()).toContain("--enable; hermes config set");
		expect(snippetText()).not.toContain("&&");
	});

	it("falls back to the key placeholder without an API key", () => {
		mockApiKeys.current = [];
		render(<NoCodingAgents compact />);

		fireEvent.click(screen.getByRole("button", { name: AGENTS_CODING_VENDOR_HERMES_LABEL }));

		expect(snippetText()).toContain('hermes config set OPENLIT_API_KEY "$OPENLIT_API_KEY"');
	});

	it("keeps the openlit CLI snippet for other vendors", () => {
		render(<NoCodingAgents compact />);

		expect(snippetText()).toContain("openlit coding install --vendor=claude-code");
	});
});
