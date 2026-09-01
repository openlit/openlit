import { fireEvent, render, screen } from "@testing-library/react";
import MemoryWriteDialog from "@/components/(playground)/memory/memory-write-dialog";

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

describe("MemoryWriteDialog", () => {
	const filterFields = [
		{ key: "userId" as const, label: "User", required: true, allowCustom: true },
		{
			key: "sessionId" as const,
			label: "Session",
			writeRequired: true,
			allowCustom: true,
		},
	];
	const filters = {
		users: [{ id: "ada", label: "ada@example.com" }],
		sessions: [{ id: "thread-1", label: "thread-1", userId: "ada" }],
		agents: [],
	};

	it("shows the same user and session comboboxes as the memory filters", () => {
		render(
			<MemoryWriteDialog
				open
				mode="add"
				scope={{ userId: "ada", sessionId: "thread-1" }}
				filterFields={filterFields}
				filters={filters}
				onOpenChange={jest.fn()}
				onSubmit={jest.fn()}
			/>
		);
		expect(screen.getByLabelText("User")).toHaveTextContent("ada@example.com");
		expect(screen.getByLabelText("Session")).toHaveTextContent("thread-1");
	});

	it("swaps reversed Zep user and session values", () => {
		render(
			<MemoryWriteDialog
				open
				mode="add"
				scope={{ userId: "thread-1", sessionId: "ada" }}
				filterFields={filterFields}
				filters={filters}
				onOpenChange={jest.fn()}
				onSubmit={jest.fn()}
			/>
		);
		expect(screen.getByLabelText("User")).toHaveTextContent("ada@example.com");
		expect(screen.getByLabelText("Session")).toHaveTextContent("thread-1");
	});

	it("submits userId and sessionId on their own fields", () => {
		const onSubmit = jest.fn();
		render(
			<MemoryWriteDialog
				open
				mode="add"
				scope={{ userId: "ada", sessionId: "thread-1" }}
				filterFields={filterFields}
				filters={filters}
				onOpenChange={jest.fn()}
				onSubmit={onSubmit}
			/>
		);
		fireEvent.change(screen.getByPlaceholderText("What should this connector remember?"), {
			target: { value: "Prefers tabs" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
		expect(onSubmit).toHaveBeenCalledWith({
			content: "Prefers tabs",
			userId: "ada",
			sessionId: "thread-1",
			agentId: undefined,
		});
	});

	it("does not put the selected email into the filter search box", () => {
		render(
			<MemoryWriteDialog
				open
				mode="add"
				scope={{ userId: "ada", sessionId: "thread-1" }}
				filterFields={filterFields}
				filters={filters}
				onOpenChange={jest.fn()}
				onSubmit={jest.fn()}
			/>
		);
		fireEvent.click(screen.getByLabelText("User"));
		const search = screen.getByPlaceholderText("Type a value and press Enter.");
		expect(search).toHaveValue("");
		expect(screen.getAllByTitle("ada@example.com").length).toBeGreaterThan(1);
	});
});
