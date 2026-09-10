import { fireEvent, render, screen } from "@testing-library/react";
import MemoryFilterCombobox from "@/components/(playground)/memory/memory-filter-combobox";

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

Object.defineProperty(global, "ResizeObserver", {
	writable: true,
	value: ResizeObserverMock,
});
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
	writable: true,
	value: jest.fn(),
});

describe("MemoryFilterCombobox", () => {
	it("uses a generic placeholder in dialogs instead of repeating the field label", () => {
		render(
			<MemoryFilterCombobox
				label="User"
				value=""
				options={[]}
				onChange={jest.fn()}
				allowCustom
				required
				inDialog
			/>
		);
		expect(screen.getByRole("button", { name: "User" })).toHaveTextContent("Select");
		expect(screen.getByRole("button", { name: "User" })).not.toHaveTextContent(
			"User User"
		);
	});

	it("lists the current custom value even when the vendor has no options", () => {
		render(
			<MemoryFilterCombobox
				label="User"
				value="aman"
				options={[]}
				onChange={jest.fn()}
				allowCustom
				required
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "User" }));
		expect(screen.getByRole("option", { name: /aman/i })).toBeInTheDocument();
	});
});
