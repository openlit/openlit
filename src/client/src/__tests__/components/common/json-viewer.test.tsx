import { render, screen } from "@testing-library/react";
import { JsonViewer } from "@textea/json-viewer";
import JSONViewer from "@/components/common/json-viewer";
import useTheme from "@/utils/hooks/useTheme";

jest.mock("@textea/json-viewer", () => {
	const actual = jest.requireActual("@textea/json-viewer");
	return { ...actual, JsonViewer: jest.fn(actual.JsonViewer) };
});

jest.mock("@/utils/hooks/useTheme", () => ({
	__esModule: true,
	default: jest.fn(() => ({ theme: "light" })),
}));

window.matchMedia = jest.fn().mockReturnValue({
	matches: false,
	addEventListener: jest.fn(),
	removeEventListener: jest.fn(),
});

const viewerProps = () => (JsonViewer as unknown as jest.Mock).mock.lastCall![0];

describe("JSONViewer", () => {
	it("shows ids and dates exactly as they arrive", () => {
		render(
			<JSONViewer
				value={{ hex: "0x1f", date: "2024-01-15", big: "12345678901234567890" }}
			/>
		);

		expect(screen.getByText(/0x1f/)).toBeInTheDocument();
		expect(screen.getByText(/2024-01-15/)).toBeInTheDocument();
		expect(screen.getByText(/12345678901234567890/)).toBeInTheDocument();
	});

	it("keeps fractional numbers and numeric arrays intact", () => {
		const { container } = render(
			<JSONViewer value={{ ratio: 1.5, tags: [10, 20] }} />
		);

		expect(screen.getByText("1.5")).toBeInTheDocument();
		expect(container).toHaveTextContent("20");
	});

	it("still treats a plain integer string as a number", () => {
		render(<JSONViewer value={{ tokens: "42" }} />);

		expect(screen.getByText("42")).toBeInTheDocument();
		expect(screen.queryByText(/"42"/)).not.toBeInTheDocument();
	});

	it("honours enableClipboard={false}", () => {
		render(<JSONViewer value={{}} enableClipboard={false} />);
		expect(viewerProps().enableClipboard).toBe(false);

		render(<JSONViewer value={{}} />);
		expect(viewerProps().enableClipboard).toBe(true);
	});

	it("follows the app theme", () => {
		(useTheme as jest.Mock).mockReturnValueOnce({ theme: "dark" });
		render(<JSONViewer value={{}} />);

		expect(viewerProps().theme).toBe("dark");
	});
});
