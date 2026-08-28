import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MemoryDetailSheet from "@/components/(playground)/memory/memory-detail-sheet";
import type { MemoryListItem } from "@/lib/platform/connectors/memory/read";

jest.mock("sonner", () => ({
	toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock("@/utils/api", () => ({
	getRequestHeaders: (headers?: Record<string, string>) => headers || {},
}));

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.defineProperty(global, "ResizeObserver", {
	writable: true,
	value: ResizeObserverMock,
});

const preview: MemoryListItem = {
	id: "mem-1",
	content: "Prefers tabs",
	kind: "profile",
	userId: "ada",
};

describe("MemoryDetailSheet writes", () => {
	beforeEach(() => {
		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				memory: preview,
				capabilities: { get: true, update: true, delete: true, feedback: false },
				connector: { name: "Mem0" },
			}),
		}) as unknown as typeof fetch;
	});

	it("shows edit and delete when the connector can write", async () => {
		render(
			<MemoryDetailSheet
				open
				memoryId="mem-1"
				connectorId="memory:abc"
				capabilities={{
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
					feedback: false,
				}}
				preview={preview}
				onClose={jest.fn()}
			/>
		);
		await waitFor(() => expect(screen.getByTitle("Edit")).toBeInTheDocument());
		expect(screen.getByTitle("Delete")).toBeInTheDocument();
	});

	it("hides edit and delete when the connector is read-only", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			ok: true,
			json: async () => ({
				memory: preview,
				capabilities: { get: true, update: false, delete: false, feedback: false },
				connector: { name: "Zep" },
			}),
		});
		render(
			<MemoryDetailSheet
				open
				memoryId="mem-1"
				capabilities={{
					add: false,
					search: true,
					get: true,
					list: true,
					update: false,
					delete: false,
					feedback: false,
				}}
				preview={preview}
				onClose={jest.fn()}
			/>
		);
		await waitFor(() => expect(screen.getByText("Zep")).toBeInTheDocument());
		expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
		expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
	});

	it("deletes a memory after confirmation", async () => {
		const onClose = jest.fn();
		const onChanged = jest.fn();
		(global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
			if (init?.method === "DELETE") {
				return { ok: true, json: async () => ({ ok: true }) };
			}
			return {
				ok: true,
				json: async () => ({
					memory: preview,
					capabilities: { get: true, update: true, delete: true, feedback: false },
					connector: { name: "Mem0" },
				}),
			};
		});
		render(
			<MemoryDetailSheet
				open
				memoryId="mem-1"
				connectorId="memory:abc"
				capabilities={{
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
					feedback: false,
				}}
				preview={preview}
				onClose={onClose}
				onChanged={onChanged}
			/>
		);
		await waitFor(() => expect(screen.getByTitle("Delete")).toBeInTheDocument());
		fireEvent.click(screen.getByTitle("Delete"));
		fireEvent.click(screen.getByRole("button", { name: "Delete memory" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(onChanged).toHaveBeenCalled();
		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining("/api/memory/mem-1"),
			expect.objectContaining({ method: "DELETE" })
		);
	});

	it("keeps the detail sheet open when edit is clicked", async () => {
		const onClose = jest.fn();
		render(
			<MemoryDetailSheet
				open
				memoryId="mem-1"
				connectorId="memory:abc"
				capabilities={{
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
					feedback: false,
				}}
				preview={preview}
				onClose={onClose}
			/>
		);
		await waitFor(() => expect(screen.getByTitle("Edit")).toBeInTheDocument());
		fireEvent.click(screen.getByTitle("Edit"));
		expect(await screen.findByText("Edit memory")).toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByTitle("Edit")).toBeInTheDocument();
	});

	it("shows the source connector and copy action for ported memories", async () => {
		const onCopy = jest.fn();
		const onOpenSource = jest.fn();
		render(
			<MemoryDetailSheet
				open
				memoryId="mem-1"
				connectorId="memory:abc"
				capabilities={{
					add: true,
					search: true,
					get: true,
					list: true,
					update: true,
					delete: true,
					feedback: false,
				}}
				preview={{
					...preview,
					port: {
						sourceConnectorId: "memory:src",
						sourceConnectorName: "Prod Mem0",
						sourceMemoryId: "src-1",
						copiedAt: "2026-08-18T12:00:00.000Z",
						contentFingerprint: "abc",
					},
				}}
				onClose={jest.fn()}
				onCopy={onCopy}
				onOpenSource={onOpenSource}
			/>
		);
		expect(await screen.findByText("Copied from")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Prod Mem0" }));
		expect(onOpenSource).toHaveBeenCalledWith("memory:src", "src-1");
		fireEvent.click(screen.getByTitle("Copy to connector"));
		expect(onCopy).toHaveBeenCalledWith("mem-1");
	});

	it("renders date-part attributes as a single datetime", async () => {
		const dateParts = {
			Day: 17,
			Hour: 11,
			Year: 2026,
			Month: 8,
			Minute: 28,
			Quarter: 3,
			"Is weekend": "No",
			"Day of week": "monday",
			"Day of year": 229,
			"Week of year": 34,
		};
		(global.fetch as jest.Mock).mockResolvedValue({
			ok: true,
			json: async () => ({
				memory: { ...preview, structuredAttributes: dateParts },
				capabilities: { get: true, update: true, delete: true, feedback: false },
				connector: { name: "Zep" },
			}),
		});
		render(
			<MemoryDetailSheet
				open
				memoryId="mem-1"
				capabilities={{
					add: false,
					search: true,
					get: true,
					list: true,
					update: false,
					delete: false,
					feedback: false,
				}}
				preview={preview}
				onClose={jest.fn()}
			/>
		);
		expect(
			await screen.findByText(new Date(2026, 7, 17, 11, 28, 0).toLocaleString())
		).toBeInTheDocument();
		expect(screen.queryByText("Day of week")).not.toBeInTheDocument();
		expect(screen.queryByText("Is weekend")).not.toBeInTheDocument();
	});
});
