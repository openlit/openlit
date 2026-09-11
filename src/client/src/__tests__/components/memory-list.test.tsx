import { fireEvent, render, screen } from "@testing-library/react";
import MemoryList from "@/components/(playground)/memory/memory-list";
import type { MemoryListItem } from "@/lib/platform/connectors/memory/read";

function memories(count: number): MemoryListItem[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `mem-${index + 1}`,
		content: `Memory ${index + 1}`,
		kind: "temporal" as const,
		createdAt: "2026-08-17T00:00:00Z",
	}));
}

describe("MemoryList pagination", () => {
	it("pages long memory lists", () => {
		const onSelect = jest.fn();
		render(
			<MemoryList
				memories={memories(21)}
				search=""
				onSearchChange={jest.fn()}
				onSelect={onSelect}
			/>
		);
		expect(screen.getByText("Memory 1")).toBeInTheDocument();
		expect(screen.queryByText("Memory 21")).not.toBeInTheDocument();
		expect(screen.getByText("1 of 2")).toBeInTheDocument();
		fireEvent.click(screen.getByLabelText("Next page"));
		expect(screen.getByText("Memory 21")).toBeInTheDocument();
		expect(screen.queryByText("Memory 1")).not.toBeInTheDocument();
	});

	it("shows the source connector for copied memories", () => {
		render(
			<MemoryList
				memories={[
					{
						...memories(1)[0],
						port: {
							sourceConnectorId: "memory:src",
							sourceConnectorName: "Prod Mem0",
							sourceMemoryId: "src-1",
							copiedAt: "2026-08-18T12:00:00.000Z",
							contentFingerprint: "abc",
						},
					},
				]}
				search=""
				onSearchChange={jest.fn()}
				onSelect={jest.fn()}
			/>
		);
		expect(screen.getByText(/Copied from/)).toBeInTheDocument();
		expect(screen.getByText(/Prod Mem0/)).toBeInTheDocument();
	});

	it("opens the page that contains the selected memory", () => {
		render(
			<MemoryList
				memories={memories(21)}
				search=""
				onSearchChange={jest.fn()}
				selectedId="mem-21"
				onSelect={jest.fn()}
			/>
		);
		expect(screen.getByText("Memory 21")).toBeInTheDocument();
		expect(screen.getByText("2 of 2")).toBeInTheDocument();
	});
});
