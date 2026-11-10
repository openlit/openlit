import { render, screen } from "@testing-library/react";
import AttributeGrid from "@/components/(playground)/observability/attribute-grid";

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

describe("AttributeGrid", () => {
	it("renders gen_ai messages sent as a JSON string as chat bubbles", () => {
		render(
			<AttributeGrid
				title="Span Attributes"
				data={{
					"gen_ai.input.messages": JSON.stringify([
						{ role: "user", parts: [{ type: "text", content: "# Hi" }] },
					]),
				}}
			/>
		);

		expect(screen.getByText("user")).toBeInTheDocument();
		expect(screen.getByTestId("markdown")).toHaveTextContent("# Hi");
	});

	it("uses markdown only for allowlisted content keys", () => {
		render(
			<AttributeGrid
				title="Span Attributes"
				data={{
					"gen_ai.content.completion": "**done**",
					"http.url": "**not markdown**",
				}}
			/>
		);

		expect(screen.getByTestId("markdown")).toHaveTextContent("**done**");
		expect(screen.getByText("**not markdown**").tagName).toBe("PRE");
	});

	it("keeps log and metric values working", () => {
		render(
			<AttributeGrid
				title="Log Attributes"
				data={{
					Body: "plain log line",
					Value: 12.5,
					Exemplars: { TraceId: "0xabc" },
					Truncated: '{"a":',
					Empty: "",
				}}
			/>
		);

		expect(screen.getByText("plain log line")).toBeInTheDocument();
		expect(screen.getByText("12.5")).toBeInTheDocument();
		expect(screen.getByTestId("json-tree")).toHaveTextContent("0xabc");
		expect(screen.getByText('{"a":')).toBeInTheDocument();
		expect(screen.queryByText("Empty")).not.toBeInTheDocument();
		expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
	});

	it("renders array rows", () => {
		render(<AttributeGrid title="Points" data={[{ Count: 3 }, "scalar"]} />);

		expect(screen.getByText("Count")).toBeInTheDocument();
		expect(screen.getByText("scalar")).toBeInTheDocument();
	});
});
