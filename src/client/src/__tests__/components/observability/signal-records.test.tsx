import { fireEvent, render, screen } from "@testing-library/react";
import SignalRecords from "@/components/(playground)/observability/signal-records";

const records: Array<[string, string, any]> = [
	["traces", "checkout", { id: "t1", spanName: "checkout" }],
	["logs", "boom", { id: "l1", Body: "boom" }],
	["metrics", "gen_ai.tokens", { id: "m1", metricName: "gen_ai.tokens" }],
	["coding_users", "dev@example.com", { id: "u1", user: "dev@example.com" }],
	["sessions", "s1", { id: "s1", session_id: "s1" }],
];

function renderRows(key: string, rows: any[]) {
	const onOpen = jest.fn();
	render(
		<SignalRecords
			config={{ key, label: key, getRowId: (row: any) => row.id } as any}
			rows={rows}
			visibilityColumns={{}}
			isFetched
			isLoading={false}
			onOpen={onOpen}
		/>
	);
	return onOpen;
}

function selectText(node: Node) {
	window.getSelection()?.selectAllChildren(node);
}

describe("SignalRecords rows", () => {
	afterEach(() => window.getSelection()?.removeAllRanges());

	describe.each(records)("%s", (key, text, row) => {
		it("opens exactly once on click", () => {
			const onOpen = renderRows(key, [row]);
			fireEvent.click(screen.getByRole("button"));
			expect(onOpen).toHaveBeenCalledTimes(1);
			expect(onOpen).toHaveBeenCalledWith(row);
		});

		it.each(["Enter", " "])("opens exactly once on key %j", (keyName) => {
			const onOpen = renderRows(key, [row]);
			const rowElement = screen.getByRole("button");
			expect(rowElement).toHaveAttribute("tabindex", "0");
			const notPrevented = fireEvent.keyDown(rowElement, { key: keyName });
			expect(onOpen).toHaveBeenCalledTimes(1);
			expect(notPrevented).toBe(false);
		});

		it("ignores other keys", () => {
			const onOpen = renderRows(key, [row]);
			fireEvent.keyDown(screen.getByRole("button"), { key: "a" });
			expect(onOpen).not.toHaveBeenCalled();
		});

		it("does not open when a click finishes a text selection in the row", () => {
			const onOpen = renderRows(key, [row]);
			selectText(screen.getByText(text));
			fireEvent.click(screen.getByRole("button"));
			expect(onOpen).not.toHaveBeenCalled();
		});
	});

	it("is not a native button, so its text can be selected", () => {
		renderRows("traces", [records[0][2]]);
		expect(screen.getByRole("button").tagName).toBe("DIV");
	});

	it("opens on click when the selection is in another row", () => {
		const first = { id: "t1", spanName: "first" };
		const second = { id: "t2", spanName: "second" };
		const onOpen = renderRows("traces", [first, second]);
		selectText(screen.getByText("first"));
		fireEvent.click(screen.getByText("second"));
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen).toHaveBeenCalledWith(second);
	});

	it("opens on click when the selection is collapsed", () => {
		const onOpen = renderRows("traces", [records[0][2]]);
		const text = screen.getByText("checkout").firstChild as Node;
		window.getSelection()?.collapse(text, 2);
		fireEvent.click(screen.getByRole("button"));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("still opens from the keyboard while text is selected in the row", () => {
		const onOpen = renderRows("traces", [records[0][2]]);
		selectText(screen.getByText("checkout"));
		fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("keeps the masked coding user row disabled", () => {
		const onOpen = renderRows("coding_users", [
			{ id: "u1", user: "low_cohort" },
		]);
		const rowElement = screen.getByRole("button");
		expect(rowElement).toHaveAttribute("aria-disabled", "true");
		expect(rowElement).not.toHaveAttribute("tabindex");
		expect(rowElement.className).toContain("cursor-not-allowed");
		fireEvent.click(rowElement);
		fireEvent.keyDown(rowElement, { key: "Enter" });
		fireEvent.keyDown(rowElement, { key: " " });
		expect(onOpen).not.toHaveBeenCalled();
	});
});
