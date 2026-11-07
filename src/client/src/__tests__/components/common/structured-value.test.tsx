import { fireEvent, render, screen } from "@testing-library/react";
import StructuredValue from "@/components/common/structured-value";

jest.mock("next/dynamic", () => ({
	__esModule: true,
	default: () =>
		function JSONViewer({ value }: { value: unknown }) {
			return <div data-testid="json-tree">{JSON.stringify(value)}</div>;
		},
}));

jest.mock("@/components/common/markdown", () => ({
	__esModule: true,
	default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

describe("StructuredValue", () => {
	it("renders chat bubbles and shows the original JSON on raw", () => {
		const raw = JSON.stringify([
			{
				role: "assistant",
				parts: [
					{ type: "text", content: "hello" },
					{ type: "tool_call", name: "search" },
				],
			},
		]);
		render(<StructuredValue value={raw} />);

		expect(screen.getByText("assistant")).toBeInTheDocument();
		expect(screen.getByTestId("markdown")).toHaveTextContent("hello");

		fireEvent.click(screen.getByRole("button", { name: "Raw" }));

		expect(screen.getByText(raw)).toBeInTheDocument();
		expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Formatted" }));

		expect(screen.getByTestId("markdown")).toBeInTheDocument();
	});

	it("renders a JSON tree for objects and JSON strings", () => {
		render(<StructuredValue value='{"a":1}' />);

		expect(screen.getByTestId("json-tree")).toHaveTextContent('{"a":1}');
	});

	it("falls back to raw without a toggle for truncated JSON", () => {
		const truncated = '[{"role":"user","par';
		render(<StructuredValue value={truncated} markdown />);

		expect(screen.getByText(truncated)).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
	});

	it("renders text as markdown only when asked to", () => {
		const { rerender } = render(<StructuredValue value="**bold**" />);

		expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();

		rerender(<StructuredValue value="**bold**" markdown />);

		expect(screen.getByTestId("markdown")).toHaveTextContent("**bold**");
		expect(screen.getByRole("button", { name: "Raw" })).toBeInTheDocument();
	});
});
