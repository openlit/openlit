import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Markdown from "@/components/common/markdown";

jest.mock("react-markdown", () => ({
	__esModule: true,
	default: jest.fn(({ children }: { children: string }) => <div>{children}</div>),
}));

jest.mock("remark-gfm", () => ({ __esModule: true, default: jest.fn() }));

jest.mock("@/components/common/code-block", () => ({
	__esModule: true,
	default: ({ code, language }: { code: string; language: string }) => (
		<pre data-language={language}>{code}</pre>
	),
}));

function markdownProps() {
	render(<Markdown content="text" />);
	return (ReactMarkdown as unknown as jest.Mock).mock.lastCall![0];
}

describe("Markdown", () => {
	it("enables GFM", () => {
		expect(markdownProps().remarkPlugins).toEqual([remarkGfm]);
	});

	it("opens links in a new tab without leaking the opener", () => {
		const { a: Link } = markdownProps().components;
		render(<Link href="https://example.com">site</Link>);

		const link = screen.getByRole("link", { name: "site" });
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noopener noreferrer");
	});

	it("shows images as text and never fetches them", () => {
		const { img: BlockedImage } = markdownProps().components;
		const { container } = render(
			<>
				<BlockedImage alt="chart" src="https://attacker.example/x.png" />
				<BlockedImage src="https://attacker.example/y.png" />
			</>
		);

		expect(container.querySelector("img")).toBeNull();
		expect(screen.getByText("chart")).toBeInTheDocument();
		expect(screen.getByText("https://attacker.example/y.png")).toBeInTheDocument();
	});

	it("sends fenced code to CodeBlock with its language", () => {
		const { pre: Pre } = markdownProps().components;
		render(
			<Pre>
				<code className="language-python">{"print(1)\n"}</code>
			</Pre>
		);

		const block = screen.getByText("print(1)");
		expect(block).toHaveAttribute("data-language", "python");
		expect(block.textContent).toBe("print(1)");
	});

	it("treats a fence without a language as plain text", () => {
		const { pre: Pre } = markdownProps().components;
		render(
			<Pre>
				<code>{"plain\n"}</code>
			</Pre>
		);

		expect(screen.getByText("plain")).toHaveAttribute("data-language", "text");
	});

	it("wraps tables so wide ones scroll", () => {
		const { table: Table } = markdownProps().components;
		const { container } = render(
			<Table>
				<tbody />
			</Table>
		);

		expect(container.querySelector("table")?.parentElement).toHaveClass("overflow-x-auto");
	});
});
