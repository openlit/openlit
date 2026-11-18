import { render, screen } from "@testing-library/react";
import ChatView from "@/components/(playground)/request/components/chat-view";
import type { TraceHeirarchySpan } from "@/types/trace";

jest.mock("@/components/(playground)/request/request-context", () => ({
	useRequest: () => [{}, jest.fn()],
}));

jest.mock("@/components/common/markdown", () => ({
	__esModule: true,
	default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

const span = (SpanName: string, SpanAttributes: Record<string, unknown>) =>
	({
		SpanId: SpanName,
		SpanName,
		SpanAttributes,
		Timestamp: "2026-01-01T00:00:00Z",
		Duration: 1000,
	}) as unknown as TraceHeirarchySpan;

const markdownTexts = () =>
	screen.getAllByTestId("markdown").map((node) => node.textContent);

describe("ChatView", () => {
	it("renders message bubbles as markdown", () => {
		render(
			<ChatView
				record={span("chat", {
					"gen_ai.input.messages": JSON.stringify([{ role: "user", content: "**hi**" }]),
					"gen_ai.output.messages": JSON.stringify([
						{ role: "assistant", parts: [{ type: "text", content: "`done`" }] },
					]),
				})}
			/>
		);

		expect(markdownTexts()).toEqual(["**hi**", "`done`"]);
	});

	it("renders thoughts and subagent tasks as markdown", () => {
		render(
			<ChatView
				record={{
					...span("coding_agent.session", {}),
					children: [
						span("coding_agent.llm.turn", {
							"coding_agent.llm.thought.text": "*thinking*",
						}),
						span("coding_agent.subagent", {
							"coding_agent.subagent.task": "**task**",
						}),
					],
				}}
			/>
		);

		expect(markdownTexts()).toEqual(expect.arrayContaining(["*thinking*", "**task**"]));
	});
});
