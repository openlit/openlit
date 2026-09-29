import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AskOtterPanel from "@/components/(playground)/chat/ask-otter-panel";

jest.mock("react-markdown", () => ({
	__esModule: true,
	default: ({ children }: { children: string }) => <div>{children}</div>,
}));

jest.mock("@/utils/api", () => ({
	getRequestHeaders: () => ({ "Content-Type": "application/json" }),
}));

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
	writable: true,
	value: jest.fn(),
});

describe("AskOtterPanel", () => {
	const copy = {
		title: "Ask Otter",
		empty: "Ask about this page.",
		placeholder: "Ask anything…",
		hint: "Answers stay on this page.",
		send: "Ask Otter",
		conversationTitle: "Ask Otter",
	};

	beforeEach(() => {
		global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === "/api/chat/config") {
				return Promise.resolve({
					ok: true,
					json: async () => ({ data: { provider: "openai" } }),
				});
			}
			if (url === "/api/chat/conversation") {
				return Promise.resolve({
					ok: true,
					json: async () => ({ data: "conv-1" }),
				});
			}
			if (url === "/api/chat/message") {
				const body = JSON.parse(String(init?.body || "{}")) as { content?: string };
				expect(body.content).toContain("PROMPT:hello");
				return Promise.resolve({
					ok: true,
					body: {
						getReader: () => ({
							read: async () => ({ done: true, value: undefined }),
						}),
					},
				});
			}
			return Promise.reject(new Error(`unexpected fetch ${url}`));
		}) as unknown as typeof fetch;
	});

	it("renders page copy and selected context, then prompts with the question", async () => {
		const buildPrompt = jest.fn((question: string) => `PROMPT:${question}`);
		render(
			<AskOtterPanel
				copy={copy}
				buildPrompt={buildPrompt}
				contextLabel="Selected: User visited New York"
			/>
		);

		expect(screen.getByText("Ask about this page.")).toBeInTheDocument();
		expect(screen.getByText("Selected: User visited New York")).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByPlaceholderText("Ask anything…")).not.toBeDisabled()
		);
		fireEvent.change(screen.getByPlaceholderText("Ask anything…"), {
			target: { value: "hello" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Ask Otter" }));
		await waitFor(() => expect(buildPrompt).toHaveBeenCalledWith("hello"));
	});
});
