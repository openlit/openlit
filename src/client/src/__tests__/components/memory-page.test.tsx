import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import MemoryPage from "@/components/(playground)/memory/memory-page";

const replaceMock = jest.fn();
let searchParams = "";

jest.mock("next/navigation", () => ({
	usePathname: () => "/memory",
	useRouter: () => ({ replace: replaceMock }),
	useSearchParams: () => new URLSearchParams(searchParams),
}));

jest.mock("posthog-js/react", () => ({
	usePostHog: () => ({ capture: jest.fn() }),
}));

jest.mock("@/store", () => ({
	useRootStore: (selector: (state: unknown) => unknown) => selector({}),
}));

jest.mock("@/utils/api", () => ({
	getRequestHeaders: (headers?: Record<string, string>) => headers || {},
}));

jest.mock("@/selectors/project", () => ({
	getCurrentProject: () => ({ id: "proj-1" }),
	getCurrentProjectEnvironment: () => "production",
}));

jest.mock("@/components/(playground)/feature-page-header", () => ({
	__esModule: true,
	default: ({ title, actions }: { title: string; actions?: ReactNode }) => (
		<div>
			<h1>{title}</h1>
			{actions}
		</div>
	),
}));

jest.mock("@/components/(playground)/telemetry-source/data-sources-page", () => ({
	SourceFormDialog: ({
		onClose,
		onSaved,
	}: {
		onClose: () => void;
		onSaved: () => void;
	}) => (
		<div data-testid="source-form-dialog">
			<button type="button" onClick={onClose}>
				close connector
			</button>
			<button type="button" data-testid="source-form-saved" onClick={onSaved}>
				saved
			</button>
		</div>
	),
}));

jest.mock("@/components/(playground)/memory/memory-graph", () => ({
	__esModule: true,
	default: ({ selectedId, onSelect }: { selectedId?: string | null; onSelect: (id: string) => void }) => (
		<button type="button" data-testid="graph-select" onClick={() => onSelect("mem-1")}>
			graph {selectedId || "none"}
		</button>
	),
}));

jest.mock("@/components/(playground)/memory/memory-list", () => ({
	__esModule: true,
	default: ({
		memories,
		selectedId,
		onSelect,
	}: {
		memories?: Array<{ id: string; content: string }>;
		selectedId?: string | null;
		onSelect: (id: string) => void;
	}) => (
		<div>
			{(memories || []).map((memory) => (
				<button key={memory.id} type="button" onClick={() => onSelect(memory.id)}>
					{memory.content}
				</button>
			))}
			<button type="button" data-testid="list-select" onClick={() => onSelect("mem-1")}>
				list {selectedId || "none"}
			</button>
		</div>
	),
}));

jest.mock("@/components/(playground)/memory/memory-detail-sheet", () => ({
	__esModule: true,
	default: ({
		open,
		memoryId,
		onClose,
	}: {
		open: boolean;
		memoryId: string | null;
		onClose: () => void;
	}) => (
		<div data-testid="detail-sheet" data-open={open ? "true" : "false"} data-id={memoryId || ""}>
			<button type="button" data-testid="close-sheet" onClick={onClose}>
				close
			</button>
		</div>
	),
}));

jest.mock("@/components/(playground)/memory/ask-otter", () => ({
	__esModule: true,
	default: ({
		scope,
	}: {
		scope?: { memoryId?: string; memoryContent?: string };
	}) => (
		<div
			data-testid="ask-otter"
			data-memory-id={scope?.memoryId || ""}
			data-memory-content={scope?.memoryContent || ""}
		/>
	),
}));

jest.mock("@/components/ui/resizable", () => ({
	ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
		<div data-testid="memory-split">{children}</div>
	),
	ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ResizableHandle: ({ "aria-label": label }: { "aria-label"?: string }) => (
		<div role="separator" aria-label={label} />
	),
}));

jest.mock("@/components/(playground)/memory/memory-copy-dialog", () => ({
	__esModule: true,
	default: ({
		open,
		onSubmit,
	}: {
		open: boolean;
		onSubmit: (input: { targetConnectorId: string }) => void;
	}) =>
		open ? (
			<div data-testid="copy-dialog">
				<button
					type="button"
					data-testid="copy-submit"
					onClick={() => onSubmit({ targetConnectorId: "memory:2" })}
				>
					submit copy
				</button>
			</div>
		) : null,
}));

jest.mock("@/components/(playground)/memory/memory-write-dialog", () => ({
	__esModule: true,
	default: ({
		open,
		onSubmit,
	}: {
		open: boolean;
		onSubmit: (input: {
			content: string;
			userId?: string;
			sessionId?: string;
			agentId?: string;
		}) => void;
	}) =>
		open ? (
			<div data-testid="write-dialog">
				<button
					type="button"
					data-testid="write-submit"
					onClick={() => onSubmit({ content: "remember this", userId: "alex" })}
				>
					submit
				</button>
			</div>
		) : null,
}));

const payload = {
	connectors: [{ id: "memory:1", name: "Mem0", type: "mem0" }],
	connector: { id: "memory:1", name: "Mem0", type: "mem0" },
	capabilities: { get: true, list: true },
	memories: [{ id: "mem-1", content: "User visited New York", kind: "temporal" }],
	stats: { total: 1, connections: 0, temporal: 1, profile: 0, summary: 0 },
	graph: { nodes: [], edges: [] },
	filters: { users: [], sessions: [], agents: [] },
	filterFields: [],
};

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

describe("MemoryPage URL selection", () => {
	beforeEach(() => {
		searchParams = "";
		replaceMock.mockReset();
		global.fetch = jest.fn().mockResolvedValue({
			ok: true,
			json: async () => payload,
		}) as unknown as typeof fetch;
	});

	it("keeps the detail sheet closed on /memory until an id is in the URL", async () => {
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByTestId("graph-select")).toBeInTheDocument());
		expect(screen.getByTestId("detail-sheet")).toHaveAttribute("data-open", "false");
		expect(screen.getByTestId("detail-sheet")).toHaveAttribute("data-id", "");
		expect(screen.getByTestId("memory-split")).toBeInTheDocument();
		expect(screen.getByRole("separator", { name: "Resize memories and Ask Otter panels" })).toBeInTheDocument();
		expect(screen.getByTestId("ask-otter")).toBeInTheDocument();
	});

	it("opens the detail sheet from ?id=", async () => {
		searchParams = "id=mem-1";
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByTestId("detail-sheet")).toHaveAttribute("data-open", "true"));
		expect(screen.getByTestId("detail-sheet")).toHaveAttribute("data-id", "mem-1");
		await waitFor(() => {
			expect(screen.getByTestId("ask-otter")).toHaveAttribute("data-memory-id", "mem-1");
			expect(screen.getByTestId("ask-otter")).toHaveAttribute(
				"data-memory-content",
				"User visited New York"
			);
		});
	});

	it("writes the memory id into the URL when a memory is selected", async () => {
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByTestId("graph-select")).toBeInTheDocument());
		fireEvent.click(screen.getByTestId("graph-select"));
		expect(replaceMock).toHaveBeenCalledWith(
			"/memory?id=mem-1&connectorId=memory%3A1",
			{ scroll: false }
		);
	});

	it("shows graph and list in separate tabs", async () => {
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByTestId("graph-select")).toBeInTheDocument());
		const graphTab = screen.getByRole("tab", { name: "Memory graph" });
		const listTab = screen.getByRole("tab", { name: "Memories" });
		expect(graphTab).toHaveAttribute("data-state", "active");
		expect(listTab).toHaveAttribute("data-state", "inactive");
		fireEvent.mouseDown(listTab);
		expect(listTab).toHaveAttribute("data-state", "active");
		expect(graphTab).toHaveAttribute("data-state", "inactive");
	});

	it("removes the memory id from the URL when the sheet closes", async () => {
		searchParams = "id=mem-1&connectorId=memory%3A1";
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByTestId("detail-sheet")).toHaveAttribute("data-open", "true"));
		fireEvent.click(screen.getByTestId("close-sheet"));
		expect(replaceMock).toHaveBeenCalledWith("/memory?connectorId=memory%3A1", {
			scroll: false,
		});
	});

	it("shows an API key hint when the connector rejects auth", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			ok: true,
			json: async () => ({
				...payload,
				memories: [],
				stats: { total: 0, connections: 0, temporal: 0, profile: 0, summary: 0 },
				hint: "auth_failed",
			}),
		});
		render(<MemoryPage />);
		await waitFor(() =>
			expect(screen.getByText("Memories are unavailable")).toBeInTheDocument()
		);
		expect(
			screen.getByText(
				"This connector rejected the API key. Edit the connector, save a valid key, and try again."
			)
		).toBeInTheDocument();
		expect(screen.queryByTestId("graph-select")).not.toBeInTheDocument();
	});

	it("hides user and session filters when the vendor declares none", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			ok: true,
			json: async () => ({
				...payload,
				connectors: [
					{
						id: "memory:read-only",
						name: "read-only memory",
						type: "mem0",
						environment: "production",
					},
				],
				connector: {
					id: "memory:read-only",
					name: "read-only memory",
					type: "mem0",
					environment: "production",
				},
				filters: { users: [{ id: "alex", label: "alex" }], sessions: [], agents: [] },
				filterFields: [],
			}),
		});
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByTestId("graph-select")).toBeInTheDocument());
		expect(screen.queryByLabelText("User")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Session")).not.toBeInTheDocument();
	});

	it("shows editable connector filters even when the vendor listed no options", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			ok: true,
			json: async () => ({
				...payload,
				filters: { users: [], sessions: [], agents: [] },
				filterFields: [
					{ key: "userId", label: "User", allowCustom: true, required: true },
					{ key: "sessionId", label: "Session", allowCustom: true },
				],
			}),
		});
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByLabelText("User")).toBeInTheDocument());
		expect(screen.getByLabelText("User")).not.toBeDisabled();
		expect(screen.getByLabelText("Session")).not.toBeDisabled();
		expect(screen.getByLabelText("User")).toHaveTextContent("User");
	});

	it("auto-selects the only required user", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			ok: true,
			json: async () => ({
				...payload,
				filters: { users: [{ id: "alex", label: "alex" }], sessions: [], agents: [] },
				filterFields: [
					{ key: "userId", label: "User", allowCustom: true, required: true },
				],
			}),
		});
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByLabelText("User")).toHaveTextContent("alex"));
	});

	it("hides copy when there is no writable destination connector", async () => {
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByTestId("graph-select")).toBeInTheDocument());
		expect(screen.queryByRole("button", { name: "Copy to connector" })).not.toBeInTheDocument();
	});

	it("copies loaded memories to another connector", async () => {
		(global.fetch as jest.Mock).mockImplementation(
			async (input: RequestInfo, init?: RequestInit) => {
				const url = String(input);
				const method = init?.method || "GET";
				if (url === "/api/memory/copy" && method === "POST") {
					return {
						ok: true,
						json: async () => ({
							copied: 1,
							failed: [],
							target: { id: "memory:2", name: "Zep" },
						}),
					};
				}
				if (url.startsWith("/api/memory")) {
					return {
						ok: true,
						json: async () => ({
							...payload,
							connectors: [
								{
									id: "memory:1",
									name: "Mem0",
									type: "mem0",
									capabilities: { add: true },
								},
								{
									id: "memory:2",
									name: "Zep",
									type: "zep",
									capabilities: { add: true },
								},
							],
							capabilities: { add: true, get: true, list: true },
						}),
					};
				}
				return { ok: true, json: async () => ({ types: [] }) };
			}
		);
		render(<MemoryPage />);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Copy to connector" })).toBeEnabled()
		);
		fireEvent.click(screen.getByRole("button", { name: "Copy to connector" }));
		fireEvent.click(screen.getByTestId("copy-submit"));
		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith(
				"/api/memory/copy",
				expect.objectContaining({ method: "POST" })
			)
		);
		expect(replaceMock).toHaveBeenCalledWith("/memory?connectorId=memory%3A2", {
			scroll: false,
		});
	});

	it("hides add memory when the connector cannot write", async () => {
		render(<MemoryPage />);
		await waitFor(() => expect(screen.getByTestId("graph-select")).toBeInTheDocument());
		expect(screen.queryByRole("button", { name: "Add memory" })).not.toBeInTheDocument();
	});

	it("shows add memory when the connector can write", async () => {
		(global.fetch as jest.Mock).mockResolvedValue({
			ok: true,
			json: async () => ({
				...payload,
				capabilities: { add: true, get: true, list: true, update: true, delete: true },
			}),
		});
		render(<MemoryPage />);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Add memory" })).toBeEnabled()
		);
		fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
		expect(screen.getByTestId("write-dialog")).toBeInTheDocument();
	});

	it("shows the connector brand logo in the memory connector dropdown", async () => {
		render(<MemoryPage />);
		const trigger = await screen.findByLabelText("Memory connector");
		fireEvent.click(trigger);
		await waitFor(() => {
			expect(
				document.querySelectorAll('img[src="/images/connectors/mem0.svg"]').length
			).toBeGreaterThan(0);
		});
	});

	it("opens the add-connector dialog on the memory page", async () => {
		render(<MemoryPage />);
		const addConnector = await screen.findByRole("button", { name: "Add connector" });
		fireEvent.click(addConnector);
		expect(screen.getByTestId("source-form-dialog")).toBeInTheDocument();
		expect(replaceMock).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(
				(global.fetch as jest.Mock).mock.calls.some(
					([url]: [RequestInfo]) => String(url) === "/api/connectors/types"
				)
			).toBe(true)
		);
	});

	it("refreshes the list after adding a memory", async () => {
		const memories = [...payload.memories];
		(global.fetch as jest.Mock).mockImplementation(
			async (input: RequestInfo, init?: RequestInit) => {
				const url = String(input);
				const method = init?.method || "GET";
				if (url === "/api/memory" && method === "POST") {
					const created = {
						id: "mem-new",
						content: "remember this",
						kind: "temporal",
					};
					memories.unshift(created);
					return {
						ok: true,
						json: async () => ({ memories: [created] }),
					};
				}
				if (url.startsWith("/api/memory")) {
					return {
						ok: true,
						json: async () => ({
							...payload,
							capabilities: {
								add: true,
								get: true,
								list: true,
								update: true,
								delete: true,
							},
							memories: [...memories],
							stats: { ...payload.stats, total: memories.length },
						}),
					};
				}
				return { ok: true, json: async () => ({ types: [] }) };
			}
		);
		render(<MemoryPage />);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Add memory" })).toBeEnabled()
		);
		fireEvent.click(screen.getByRole("button", { name: "Add memory" }));
		fireEvent.click(screen.getByTestId("write-submit"));
		await waitFor(() =>
			expect(screen.getByText("remember this")).toBeInTheDocument()
		);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Load" })).toBeEnabled()
		);
		const calls = (global.fetch as jest.Mock).mock.calls.map(
			([url, init]: [RequestInfo, RequestInit?]) => [
				String(url),
				init?.method || "GET",
			]
		);
		const postIndex = calls.findIndex(
			([url, method]) => url === "/api/memory" && method === "POST"
		);
		expect(postIndex).toBeGreaterThanOrEqual(0);
		expect(
			calls
				.slice(postIndex + 1)
				.some(([url, method]) => url.startsWith("/api/memory?") && method === "GET")
		).toBe(true);
	});
});
