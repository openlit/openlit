import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import MemoryCopyDialog from "@/components/(playground)/memory/memory-copy-dialog";

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
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
	writable: true,
	value: jest.fn(),
});

const zepTarget = {
	id: "memory:zep",
	name: "prod-zep",
	type: "zep",
	environment: "production",
	capabilities: { add: true },
	filterFields: [
		{ key: "userId" as const, label: "User", required: true, allowCustom: true },
		{
			key: "sessionId" as const,
			label: "Session",
			writeRequired: true,
			allowCustom: true,
		},
	],
};

const mem0Target = {
	id: "memory:mem0",
	name: "prod-mem0",
	type: "mem0",
	environment: "production",
	capabilities: { add: true },
	filterFields: [
		{ key: "userId" as const, label: "User", allowCustom: true },
		{ key: "sessionId" as const, label: "Session", allowCustom: true },
		{ key: "agentId" as const, label: "Agent", allowCustom: true },
	],
};

function jsonResponse(body: unknown) {
	return {
		ok: true,
		json: async () => body,
	};
}

describe("MemoryCopyDialog", () => {
	beforeEach(() => {
		(global.fetch as jest.Mock | undefined) = jest.fn((url: string) => {
			const href = String(url);
			if (href.includes("connectorId=memory%3Azep")) {
				return Promise.resolve(
					jsonResponse({
						filters: {
							users: [{ id: "ada", label: "ada@example.com" }],
							sessions: [{ id: "thread-1", label: "thread-1", userId: "ada" }],
							agents: [],
						},
						filterFields: zepTarget.filterFields,
					})
				);
			}
			if (href.includes("connectorId=memory%3Amem0")) {
				return Promise.resolve(
					jsonResponse({
						filters: {
							users: [{ id: "mem0-user", label: "mem0-user" }],
							sessions: [{ id: "mem0-session", label: "mem0-session" }],
							agents: [{ id: "mem0-agent", label: "mem0-agent" }],
						},
						filterFields: mem0Target.filterFields,
					})
				);
			}
			return Promise.resolve(
				jsonResponse({
					filters: {
						users: [],
						sessions: [
							{
								id: "memstore_016B8h7mS5FdSxfz92reXzKb",
								label: "OpenLIT connector",
							},
						],
						agents: [],
					},
				})
			);
		});
	});

	afterEach(() => {
		(global.fetch as jest.Mock).mockReset();
	});

	it("does not repeat the User and Session labels in the empty combobox", async () => {
		render(
			<MemoryCopyDialog
				open
				count={1}
				targets={[zepTarget]}
				onOpenChange={jest.fn()}
				onSubmit={jest.fn()}
			/>
		);
		await waitFor(() => expect(global.fetch).toHaveBeenCalled());
		expect(screen.getByLabelText("User")).toHaveTextContent("Select");
		expect(screen.getByLabelText("User")).not.toHaveTextContent("User User");
		expect(screen.getByLabelText("Session")).toHaveTextContent("Select");
	});

	it("loads user and session options for the selected destination connector", async () => {
		render(
			<MemoryCopyDialog
				open
				count={1}
				targets={[zepTarget]}
				onOpenChange={jest.fn()}
				onSubmit={jest.fn()}
			/>
		);
		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith(
				"/api/memory?connectorId=memory%3Azep&limit=1",
				expect.objectContaining({ signal: expect.any(AbortSignal) })
			)
		);
		await waitFor(() =>
			expect(screen.getByLabelText("User")).not.toBeDisabled()
		);
		fireEvent.click(screen.getByLabelText("User"));
		expect(screen.getByRole("option", { name: /ada@example.com/i })).toBeInTheDocument();
		expect(
			screen.queryByRole("option", { name: /OpenLIT connector/i })
		).not.toBeInTheDocument();
	});

	it("shows the destination vendor fields and options, not Claude stores", async () => {
		render(
			<MemoryCopyDialog
				open
				count={1}
				targets={[mem0Target]}
				onOpenChange={jest.fn()}
				onSubmit={jest.fn()}
			/>
		);
		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith(
				"/api/memory?connectorId=memory%3Amem0&limit=1",
				expect.objectContaining({ signal: expect.any(AbortSignal) })
			)
		);
		await waitFor(() =>
			expect(screen.getByLabelText("Agent")).not.toBeDisabled()
		);
		fireEvent.click(screen.getByLabelText("Agent"));
		expect(screen.getByRole("option", { name: /mem0-agent/i })).toBeInTheDocument();
		expect(
			screen.queryByRole("option", { name: /OpenLIT connector/i })
		).not.toBeInTheDocument();
	});
});
