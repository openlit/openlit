import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ScannerFindingSheet from "@/components/(playground)/scanner/scanner-finding-sheet";
import type { ScannerEnrichRun, ScannerFinding, ScannerJob } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_ENRICH,
	SCANNER_ENRICH_COPIED,
	SCANNER_ENRICH_COPY,
	SCANNER_ENRICH_DIALOG_TITLE,
	SCANNER_ENRICH_DISCARD,
	SCANNER_ENRICH_FIX_COPIED,
	SCANNER_ENRICH_IN_PROGRESS,
	SCANNER_ENRICH_KEY_FROM_VAULT,
	SCANNER_ENRICH_NO_LOCATION,
	SCANNER_ENRICH_REVIEW_TITLE,
	SCANNER_ENRICH_RUN_NOT_FOUND,
	SCANNER_ENRICH_RUNNING,
	SCANNER_ENRICH_RUNNING_TITLE,
} from "@/constants/messages/en";

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("sonner", () => ({
	toast: {
		success: (...args: unknown[]) => mockToast.success(...args),
		error: (...args: unknown[]) => mockToast.error(...args),
	},
}));
jest.mock("@/utils/api", () => ({
	getRequestHeaders: (headers?: Record<string, string>) => ({ "x-test": "1", ...(headers || {}) }),
}));

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.defineProperty(global, "ResizeObserver", { writable: true, value: ResizeObserverMock });
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { writable: true, value: jest.fn() });
Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { writable: true, value: () => false });

const FIX = 'Remove "Bash" from this subagent\'s tools list.';
const finding: ScannerFinding = {
	id: "f2",
	ruleId: "CSDK-101",
	severity: "high",
	path: "agent/agent.py",
	line: 4,
	endLine: 9,
	title: "Claude subagent is granted the Bash tool",
	fix: FIX,
};
const job: ScannerJob = {
	id: "job:1",
	status: "succeeded",
	target: "https://github.com/acme/agents",
	ref: "main",
	startedAt: "2026-11-12T00:00:00.000Z",
	findings: [{ id: "f1", ruleId: "META-005", severity: "info", title: "Rules skipped" }, finding],
};
const providers = [
	{ id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY", hasKey: true, models: [] },
];

function run(overrides: Partial<ScannerEnrichRun> = {}): ScannerEnrichRun {
	return {
		id: "enrich:abc",
		status: "running",
		jobId: "job:1",
		alertNumber: 2,
		findingKey: "k",
		ruleId: "CSDK-101",
		target: job.target,
		provider: "anthropic",
		attempts: 1,
		attempt: 1,
		recheck: true,
		steps: [
			{ key: "clone", status: "done" },
			{ key: "enrich", status: "running" },
			{ key: "recheck", status: "pending" },
			{ key: "diff", status: "pending" },
		],
		startedAt: new Date().toISOString(),
		...overrides,
	};
}

type Handler = (url: string, init: RequestInit) => unknown;
let routes: Record<string, Handler>;
const NETWORK_DOWN = Symbol("network down");
const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
	const key = `${init.method || "GET"} ${url.split("?")[0]}`;
	const handler = routes[key];
	if (!handler) return { ok: false, status: 404, json: async () => "not found" };
	const body = handler(url, init);
	if (body === NETWORK_DOWN) throw new TypeError("Failed to fetch");
	if (body instanceof Error) return { ok: false, status: 400, json: async () => body.message };
	return { ok: true, status: 200, json: async () => body };
});

const BASE = "/api/scanners/scanner%3A1/enrich";

function renderSheet(props: Partial<{ finding: ScannerFinding; connectorId?: string }> = {}) {
	return render(
		<ScannerFindingSheet
			open
			finding={props.finding ?? finding}
			alertNumber={2}
			job={job}
			connectorId={"connectorId" in props ? props.connectorId : "scanner:1"}
			onClose={jest.fn()}
		/>
	);
}

beforeEach(() => {
	jest.clearAllMocks();
	routes = {
		[`GET ${BASE}`]: () => ({ run: null }),
		[`GET ${BASE}/providers`]: () => ({ providers }),
	};
	global.fetch = fetchMock as unknown as typeof fetch;
	Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => undefined) } });
});

afterEach(() => {
	jest.useRealTimers();
});

describe("ScannerFindingSheet suggested fix actions", () => {
	it("copies the suggested fix and confirms it", async () => {
		renderSheet();
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH_COPY }));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(FIX);
		expect(await screen.findByRole("button", { name: SCANNER_ENRICH_COPIED })).toBeInTheDocument();
		expect(mockToast.success).toHaveBeenCalledWith(SCANNER_ENRICH_FIX_COPIED);
	});

	it("disables Enrich with a reason when the finding has no code location", async () => {
		renderSheet({ finding: { ...finding, path: undefined, line: undefined } });
		const button = screen.getByRole("button", { name: SCANNER_ENRICH });
		expect(button).toBeDisabled();
		expect(button.closest("[title]")).toHaveAttribute("title", SCANNER_ENRICH_NO_LOCATION);
	});

	it("hides Enrich without a connector", () => {
		renderSheet({ connectorId: undefined });
		expect(screen.queryByRole("button", { name: SCANNER_ENRICH })).not.toBeInTheDocument();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("loads the latest run for the finding", async () => {
		routes[`GET ${BASE}`] = () => ({ run: run({ status: "succeeded", diff: "--- a\n+++ b\n", steps: [] }) });
		renderSheet();
		expect(await screen.findByText(SCANNER_ENRICH_REVIEW_TITLE)).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			`${BASE}?jobId=job%3A1&alertNumber=2`,
			expect.objectContaining({ headers: expect.objectContaining({ "x-test": "1" }) })
		);
	});

	it("starts Enrich from the dialog and shows the running panel", async () => {
		const posted: unknown[] = [];
		routes[`POST ${BASE}`] = (_url, init) => {
			posted.push(JSON.parse(String(init.body)));
			return { run: run() };
		};
		routes[`GET ${BASE}/enrich%3Aabc`] = () => ({ run: run() });
		renderSheet();
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH }));
		expect(await screen.findByText(SCANNER_ENRICH_DIALOG_TITLE)).toBeInTheDocument();
		await screen.findByText(SCANNER_ENRICH_KEY_FROM_VAULT("ANTHROPIC_API_KEY"));
		fireEvent.click(screen.getAllByRole("button", { name: SCANNER_ENRICH }).at(-1)!);
		expect(await screen.findByText(SCANNER_ENRICH_RUNNING_TITLE("Trustabl default"))).toBeInTheDocument();
		expect(posted).toEqual([
			{ jobId: "job:1", alertNumber: 2, provider: "anthropic", attempts: 1, recheck: true, baseRef: "main" },
		]);
		expect(screen.getByRole("button", { name: SCANNER_ENRICH_IN_PROGRESS })).toBeDisabled();
	});

	it("shows the server error when a run cannot start", async () => {
		routes[`POST ${BASE}`] = () => new Error(SCANNER_ENRICH_RUNNING);
		renderSheet();
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH }));
		await screen.findByText(SCANNER_ENRICH_KEY_FROM_VAULT("ANTHROPIC_API_KEY"));
		fireEvent.click(screen.getAllByRole("button", { name: SCANNER_ENRICH }).at(-1)!);
		await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(SCANNER_ENRICH_RUNNING));
	});

	it("polls a running run until it finishes", async () => {
		jest.useFakeTimers();
		let polls = 0;
		routes[`GET ${BASE}`] = () => ({ run: run() });
		routes[`GET ${BASE}/enrich%3Aabc`] = () => {
			polls += 1;
			return { run: run({ status: "succeeded", diff: "--- a\n+++ b\n", steps: [] }) };
		};
		renderSheet();
		expect(await screen.findByRole("button", { name: SCANNER_ENRICH_IN_PROGRESS })).toBeDisabled();
		await act(async () => {
			jest.advanceTimersByTime(1000);
		});
		expect(await screen.findByText(SCANNER_ENRICH_REVIEW_TITLE)).toBeInTheDocument();
		await act(async () => {
			jest.advanceTimersByTime(3000);
		});
		expect(polls).toBe(1);
	});

	it("keeps the running panel and polls again after a network failure", async () => {
		jest.useFakeTimers();
		let polls = 0;
		routes[`GET ${BASE}`] = () => ({ run: run() });
		routes[`GET ${BASE}/enrich%3Aabc`] = () => {
			polls += 1;
			return polls === 1 ? NETWORK_DOWN : { run: run({ status: "succeeded", diff: "--- a\n+++ b\n", steps: [] }) };
		};
		renderSheet();
		expect(await screen.findByRole("button", { name: SCANNER_ENRICH_IN_PROGRESS })).toBeDisabled();
		await act(async () => {
			jest.advanceTimersByTime(1000);
		});
		expect(screen.getByRole("button", { name: SCANNER_ENRICH_IN_PROGRESS })).toBeDisabled();
		expect(mockToast.error).not.toHaveBeenCalled();
		await act(async () => {
			jest.advanceTimersByTime(1000);
		});
		expect(await screen.findByText(SCANNER_ENRICH_REVIEW_TITLE)).toBeInTheDocument();
		expect(polls).toBe(2);
	});

	it("clears the panel when the server no longer has the run", async () => {
		jest.useFakeTimers();
		routes[`GET ${BASE}`] = () => ({ run: run() });
		routes[`GET ${BASE}/enrich%3Aabc`] = () => new Error(SCANNER_ENRICH_RUN_NOT_FOUND);
		renderSheet();
		expect(await screen.findByRole("button", { name: SCANNER_ENRICH_IN_PROGRESS })).toBeDisabled();
		await act(async () => {
			jest.advanceTimersByTime(1000);
		});
		expect(await screen.findByRole("button", { name: SCANNER_ENRICH })).toBeEnabled();
		expect(mockToast.error).toHaveBeenCalledWith(SCANNER_ENRICH_RUN_NOT_FOUND);
	});

	it("discards a finished run", async () => {
		let deleted = false;
		routes[`GET ${BASE}`] = () => ({ run: run({ status: "cancelled" }) });
		routes[`DELETE ${BASE}/enrich%3Aabc`] = () => {
			deleted = true;
			return { ok: true };
		};
		renderSheet();
		fireEvent.click(await screen.findByRole("button", { name: SCANNER_ENRICH_DISCARD }));
		await waitFor(() => expect(deleted).toBe(true));
		await waitFor(() => expect(screen.queryByRole("button", { name: SCANNER_ENRICH_DISCARD })).not.toBeInTheDocument());
	});
});
