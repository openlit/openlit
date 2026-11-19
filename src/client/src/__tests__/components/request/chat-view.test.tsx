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

	it("shows system instructions sent outside the messages once, before the user turn", () => {
		const system = JSON.stringify([{ type: "text", content: "You are Hermes." }]);
		const input = JSON.stringify([{ role: "user", parts: [{ type: "text", content: "hi" }] }]);
		render(
			<ChatView
				record={{
					...span("invoke_agent hermes", {}),
					children: [
						span("chat one", { "gen_ai.system_instructions": system, "gen_ai.input.messages": input }),
						span("chat two", { "gen_ai.system_instructions": system, "gen_ai.input.messages": input }),
					],
				}}
			/>
		);

		expect(markdownTexts()).toEqual(["You are Hermes.", "hi"]);
	});

	it("skips system instructions when the input messages already carry a system message", () => {
		render(
			<ChatView
				record={span("chat", {
					"gen_ai.system_instructions": JSON.stringify([{ type: "text", content: "Be brief." }]),
					"gen_ai.input.messages": JSON.stringify([
						{ role: "system", content: "Be brief." },
						{ role: "user", content: "hi" },
					]),
				})}
			/>
		);

		expect(markdownTexts()).toEqual(["Be brief.", "hi"]);
	});

	it("keeps a parent's system instructions when its messages are skipped for a child's", () => {
		const input = JSON.stringify([{ role: "user", parts: [{ type: "text", content: "hi" }] }]);
		render(
			<ChatView
				record={{
					...span("generateText", {
						"gen_ai.system_instructions": JSON.stringify([{ type: "text", content: "Be kind." }]),
						"gen_ai.input.messages": input,
					}),
					children: [span("chat", { "gen_ai.input.messages": input })],
				}}
			/>
		);

		expect(markdownTexts()).toEqual(["Be kind.", "hi"]);
	});

	it("skips system instructions truncated mid-JSON", () => {
		render(
			<ChatView
				record={span("chat", {
					"gen_ai.system_instructions": '[{"type": "text", "content": "You are',
					"gen_ai.input.messages": JSON.stringify([{ role: "user", content: "hi" }]),
				})}
			/>
		);

		expect(markdownTexts()).toEqual(["hi"]);
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
