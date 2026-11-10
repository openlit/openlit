import { fireEvent, render, screen } from "@testing-library/react";
import SpanContentSearch from "@/components/(playground)/filter/span-content-search";
import { SPAN_SEARCH_MAX_LENGTH } from "@/constants/traces";
import { OBSERVABILITY_SPAN_SEARCH_PLACEHOLDER } from "@/constants/messages/en";

const input = () => screen.getByLabelText(OBSERVABILITY_SPAN_SEARCH_PLACEHOLDER);

describe("SpanContentSearch", () => {
	it("submits on Enter, not per keystroke", () => {
		const onSubmit = jest.fn();
		render(<SpanContentSearch value="" onSubmit={onSubmit} />);

		fireEvent.change(input(), { target: { value: " refund " } });
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.keyDown(input(), { key: "Enter" });
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith("refund");
	});

	it("sends an empty string when cleared", () => {
		const onSubmit = jest.fn();
		render(<SpanContentSearch value="refund" onSubmit={onSubmit} />);

		fireEvent.change(input(), { target: { value: "" } });
		fireEvent.keyDown(input(), { key: "Enter" });

		expect(onSubmit).toHaveBeenCalledWith("");
	});

	it("does not rerun an unchanged search", () => {
		const onSubmit = jest.fn();
		render(<SpanContentSearch value="refund" onSubmit={onSubmit} />);

		fireEvent.keyDown(input(), { key: "Enter" });

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("follows the store when filters are cleared elsewhere", () => {
		const { rerender } = render(<SpanContentSearch value="refund" onSubmit={jest.fn()} />);

		rerender(<SpanContentSearch value="" onSubmit={jest.fn()} />);

		expect(input()).toHaveValue("");
	});

	it("limits the input length", () => {
		render(<SpanContentSearch value="" onSubmit={jest.fn()} />);

		expect(input()).toHaveAttribute("maxLength", String(SPAN_SEARCH_MAX_LENGTH));
	});
});
