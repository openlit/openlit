import { fireEvent, render, screen } from "@testing-library/react";
import copyToCB from "copy-to-clipboard";
import CodeBlock from "@/components/common/code-block";

jest.mock("copy-to-clipboard", () => ({ __esModule: true, default: jest.fn() }));

jest.mock("react-syntax-highlighter", () => ({
	Prism: ({ children }: { children: string }) => <pre>{children}</pre>,
}));

jest.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({ dracula: {} }));

describe("CodeBlock", () => {
	it("offers a labelled copy button that keyboard users can reach", () => {
		render(<CodeBlock code="print(1)" language="python" />);

		const button = screen.getByRole("button", { name: "Copy code" });
		button.focus();
		expect(button).toHaveFocus();
		expect(button).toHaveClass("focus-visible:opacity-100");

		fireEvent.click(button);
		expect(copyToCB).toHaveBeenCalledWith("print(1)");
	});

	it("hides the copy button when copy is off", () => {
		render(<CodeBlock code="x" language="text" copy={false} />);

		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});
});
