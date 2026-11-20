import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import ScannerPage from "@/components/(playground)/scanner/scanner-page";
import type { ScannerForgeRun, ScannerJob } from "@/lib/platform/connectors/scanner/types";
import {
	CANCEL,
	SCANNER_FORGE_CANCELLED,
	SCANNER_FORGE_DONE,
	SCANNER_FORGE_PARAMS_TITLE,
	SCANNER_FORGE_RUN,
	SCANNER_FORGE_RUNNING_TITLE,
	SCANNER_RUN_MENU,
	SCANNER_TAB_ANALYZER,
	SCANNER_TAB_FORGE,
} from "@/constants/messages/en";

jest.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(""),
}));

jest.mock("next/image", () => ({
	__esModule: true,
	default: () => <span />,
}));

jest.mock("sonner", () => ({
	toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), loading: jest.fn() },
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
	SourceFormDialog: () => null,
}));

jest.mock("@/components/(playground)/scanner/scanner-runtime-panel", () => ({
	__esModule: true,
	default: () => null,
}));

jest.mock("@/components/(playground)/scanner/scanner-workspace", () => ({
	__esModule: true,
	formatDuration: () => "—",
	Stat: () => null,
	default: () => <div data-testid="analyzer-workspace" />,
}));

jest.mock("@/components/common/markdown", () => ({
	__esModule: true,
	default: ({ content }: { content: string }) => <div>{content}</div>,
}));

jest.mock("@/components/(playground)/scanner/scanner-finding-sheet", () => ({
	__esModule: true,
	default: () => null,
}));

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.defineProperty(global, "ResizeObserver", { writable: true, value: ResizeObserverMock });

const TARGET = "https://github.com/anthropics/claude-agent-sdk-demos";
const JOB: ScannerJob = {
	id: "job:1",
	status: "succeeded",
	target: TARGET,
	startedAt: "2026-11-09T10:45:45.000Z",
	findingCount: 42,
	report: { sdks: ["claude_agent_sdk"], mcpCount: 1 } as ScannerJob["report"],
};
const FORGE_RUN: ScannerForgeRun = {
	id: "forge:1",
	status: "succeeded",
	target: TARGET,
	policies: ["claude_sdk", "mcp"],
	policySource: { kind: "analyzer", jobId: "job:1", scannedAt: JOB.startedAt },
	fileName: "SKILL.md",
	startedAt: "2026-11-10T11:32:08.000Z",
};

type Connector = {
	id: string;
	name: string;
	type: string;
	settings: string;
	jobs: ScannerJob[];
	forgeRuns: ScannerForgeRun[];
	capabilities?: { forge?: boolean };
};

let connector: Connector;
let forgeResponse: (init: RequestInit) => Promise<unknown>;
const fetchMock = jest.fn();

function connectorWith(over: Partial<Connector> = {}): Connector {
	return {
		id: "scanner:1",
		name: "Trustabl – agent SDK demos",
		type: "trustabl",
		settings: JSON.stringify({ target: TARGET }),
		jobs: [JOB],
		forgeRuns: [],
		capabilities: { forge: true },
		...over,
	};
}

function json(body: unknown, ok = true) {
	return Promise.resolve({ ok, json: async () => body });
}

beforeEach(() => {
	jest.clearAllMocks();
	connector = connectorWith();
	forgeResponse = () => json({ run: FORGE_RUN });
	fetchMock.mockImplementation((url: string, init: RequestInit = {}) => {
		if (url === "/api/scanners") return json({ connectors: [connector] });
		if (url === "/api/connectors/types") return json({ types: [] });
		if (url === "/api/scanners/scanner%3A1/forge" && init.method === "POST") return forgeResponse(init);
		if (url.endsWith("/check")) return json({ check: { status: "current", message: "up to date", checkedAt: "x" } });
		if (url.includes("/forge/")) return json({ run: { ...FORGE_RUN, content: "# skill" } });
		return json({});
	});
	global.fetch = fetchMock as unknown as typeof fetch;
});

async function openMenu() {
	const trigger = await screen.findByRole("button", { name: SCANNER_RUN_MENU });
	await waitFor(() => expect(trigger).toBeEnabled());
	fireEvent.keyDown(trigger, { key: "Enter" });
}

function forgeCall() {
	return fetchMock.mock.calls.find(
		([url, init]) => url === "/api/scanners/scanner%3A1/forge" && init?.method === "POST"
	);
}

describe("ScannerPage Forge", () => {
	it("shows Analyzer and Forge tabs for connectors that support forge", async () => {
		render(<ScannerPage />);
		expect(await screen.findByRole("tab", { name: new RegExp(SCANNER_TAB_ANALYZER) })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: new RegExp(SCANNER_TAB_FORGE) })).toBeInTheDocument();
	});

	it("hides Forge for connectors without the capability", async () => {
		connector = connectorWith({ capabilities: {} });
		render(<ScannerPage />);
		await screen.findByTestId("analyzer-workspace");
		expect(screen.queryByRole("tab", { name: new RegExp(SCANNER_TAB_FORGE) })).not.toBeInTheDocument();
		await openMenu();
		expect(screen.queryByRole("menuitem", { name: new RegExp(SCANNER_FORGE_RUN) })).not.toBeInTheDocument();
	});

	it("runs Forge with policies prefilled from the latest Analyzer scan", async () => {
		render(<ScannerPage />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Run Forge Generate/ }));
		await waitFor(() => expect(toast.success).toHaveBeenCalledWith(SCANNER_FORGE_DONE, expect.anything()));
		expect(JSON.parse(String(forgeCall()?.[1]?.body))).toEqual({
			target: TARGET,
			policies: ["claude_sdk", "mcp"],
			sourceJobId: "job:1",
		});
	});

	it("shows the running state and cancels the request", async () => {
		forgeResponse = (init) =>
			new Promise((_, reject) => {
				init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		render(<ScannerPage />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Run Forge Generate/ }));
		expect(await screen.findByText(SCANNER_FORGE_RUNNING_TITLE)).toBeInTheDocument();
		expect(screen.getByText("$ trustabl forge --policy claude_sdk,mcp")).toBeInTheDocument();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: CANCEL }));
		});
		await waitFor(() => expect(toast.info).toHaveBeenCalledWith(SCANNER_FORGE_CANCELLED, expect.anything()));
		await waitFor(() => expect(screen.queryByText(SCANNER_FORGE_RUNNING_TITLE)).not.toBeInTheDocument());
	});

	it("refreshes until a forge run still going on the server finishes", async () => {
		connector = connectorWith({ forgeRuns: [{ ...FORGE_RUN, status: "running" }] });
		render(<ScannerPage />);
		await screen.findByRole("tab", { name: new RegExp(SCANNER_TAB_FORGE) });
		const loads = () => fetchMock.mock.calls.filter(([url]) => url === "/api/scanners").length;
		await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
		const settled = loads();
		connector = connectorWith({ forgeRuns: [FORGE_RUN] });
		await waitFor(() => expect(loads()).toBeGreaterThan(settled), { timeout: 5000 });
	});

	it("keeps the running card on screen while it refreshes", async () => {
		connector = connectorWith({ forgeRuns: [{ ...FORGE_RUN, status: "running", command: "trustabl forge --policy mcp" }] });
		render(<ScannerPage />);
		fireEvent.mouseDown(await screen.findByRole("tab", { name: new RegExp(SCANNER_TAB_FORGE) }));
		expect(await screen.findByText(SCANNER_FORGE_RUNNING_TITLE)).toBeInTheDocument();
		await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
		const settled = fetchMock.mock.calls.length;
		let release: () => void = () => undefined;
		const base = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation((url: string, init?: RequestInit) =>
			url === "/api/scanners"
				? new Promise((resolve) => {
						release = () => resolve(base(url, init));
					})
				: base(url, init)
		);
		await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(settled), { timeout: 5000 });
		expect(screen.getByText(SCANNER_FORGE_RUNNING_TITLE)).toBeInTheDocument();
		await act(async () => release());
	});

	it("stays on the repository it just forged", async () => {
		const other = "https://github.com/acme/forged";
		forgeResponse = () => {
			connector = connectorWith({ forgeRuns: [{ ...FORGE_RUN, id: "forge:2", target: other }] });
			return json({ run: { ...FORGE_RUN, id: "forge:2", target: other } });
		};
		render(<ScannerPage />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /Run Forge with new parameters/ }));
		fireEvent.change(await screen.findByLabelText("Repository URL"), { target: { value: other } });
		fireEvent.click(screen.getByRole("button", { name: SCANNER_FORGE_RUN }));
		await waitFor(() => expect(toast.success).toHaveBeenCalledWith(SCANNER_FORGE_DONE, expect.anything()));
		await waitFor(() => expect(screen.getByText("acme/forged")).toBeInTheDocument());
		await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
		expect(screen.getByText("acme/forged")).toBeInTheDocument();
	});

	it("opens the parameters dialog when no Analyzer scan can prefill policies", async () => {
		connector = connectorWith({ jobs: [] });
		render(<ScannerPage />);
		await openMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Run Forge Choose/ }));
		expect(await screen.findByText(SCANNER_FORGE_PARAMS_TITLE)).toBeInTheDocument();
		expect(forgeCall()).toBeUndefined();
	});

	it("lists repositories that only have forge runs", async () => {
		connector = connectorWith({
			jobs: [],
			settings: "{}",
			forgeRuns: [{ ...FORGE_RUN, target: "https://github.com/acme/forged" }],
		});
		render(<ScannerPage />);
		expect(await screen.findByText("acme/forged")).toBeInTheDocument();
	});
});
