import { fireEvent, render, screen } from "@testing-library/react";
import ScannerEnrichPanel from "@/components/(playground)/scanner/scanner-enrich-panel";
import type { ScannerEnrichRun, ScannerFinding } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_ENRICH_ATTEMPT,
	SCANNER_ENRICH_CANCELLED,
	SCANNER_ENRICH_CANCELLED_TITLE,
	SCANNER_ENRICH_COPY_DIFF,
	SCANNER_ENRICH_DIFF_COPIED,
	SCANNER_ENRICH_DISCARD,
	SCANNER_ENRICH_FAILED_PROVIDER,
	SCANNER_ENRICH_FAILED_STILL_DETECTED,
	SCANNER_ENRICH_HIDE_LOG,
	SCANNER_ENRICH_NOT_RECHECKED,
	SCANNER_ENRICH_RESOLVED_BADGE,
	SCANNER_ENRICH_RETRY,
	SCANNER_ENRICH_REVIEW_TITLE,
	SCANNER_ENRICH_RUNNING_TITLE,
	SCANNER_ENRICH_STEP_CLONE,
	SCANNER_ENRICH_STEP_DIFF,
	SCANNER_ENRICH_STEP_ENRICH,
	SCANNER_ENRICH_STEP_RECHECK,
	SCANNER_ENRICH_STILL_DETECTED,
	SCANNER_ENRICH_VIEW_LOG,
	SCANNER_ENRICH_VIEW_PARTIAL_DIFF,
	SCANNER_ENRICH_MODEL_DEFAULT,
	CANCEL,
} from "@/constants/messages/en";

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => mockToast.success(...a), error: (...a: unknown[]) => mockToast.error(...a) } }));

const finding: ScannerFinding = {
	id: "f4",
	ruleId: "CSDK-101",
	severity: "high",
	path: "agent/agent.py",
	line: 4,
	endLine: 9,
	title: "Claude subagent is granted the Bash tool",
};

const REMOVED = '-        tools=["Glob", "Read", "Bash", "Write"],';
// Diff lines keep their indentation, so match them without whitespace collapsing.
const EXACT = { normalizer: (text: string) => text };

const DIFF = [
	"--- a/agent/agent.py",
	"+++ b/agent/agent.py",
	"@@ -4,5 +4,5 @@",
	'     "data-analyst": AgentDefinition(',
	'-        tools=["Glob", "Read", "Bash", "Write"],',
	'+        tools=["Glob", "Read", "Write"],',
	'         prompt="You analyse data.",',
	"",
].join("\n");

function baseRun(overrides: Partial<ScannerEnrichRun> = {}): ScannerEnrichRun {
	return {
		id: "enrich:1",
		status: "running",
		jobId: "job:1",
		alertNumber: 4,
		findingKey: "CSDK-101|agent/agent.py||",
		ruleId: "CSDK-101",
		path: "agent/agent.py",
		line: 4,
		endLine: 9,
		target: "https://github.com/acme/agents",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		attempts: 2,
		attempt: 1,
		recheck: true,
		steps: [
			{ key: "clone", status: "done", detail: "main @ 826b268", durationMs: 2100 },
			{ key: "enrich", status: "running", detail: "anthropic · claude-sonnet-4-5 · agent/agent.py:4-9" },
			{ key: "recheck", status: "pending" },
			{ key: "diff", status: "pending" },
		],
		log: ["$ trustabl enrich --input finding-4.json --repo repo --apply --diff", "enriching 1/1 findings (grouped by file)"],
		startedAt: new Date().toISOString(),
		...overrides,
	};
}

function renderPanel(run: ScannerEnrichRun) {
	const handlers = { onCancel: jest.fn(), onDiscard: jest.fn(), onRetry: jest.fn() };
	render(<ScannerEnrichPanel run={run} finding={finding} {...handlers} />);
	return handlers;
}

beforeEach(() => {
	jest.clearAllMocks();
	Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => undefined) } });
});

describe("ScannerEnrichPanel", () => {
	it("shows the running steps, attempt and Cancel", () => {
		const { onCancel } = renderPanel(baseRun());
		expect(screen.getByText(SCANNER_ENRICH_RUNNING_TITLE("claude-sonnet-4-5"))).toBeInTheDocument();
		expect(screen.getByText(SCANNER_ENRICH_ATTEMPT(1, 2), { exact: false })).toBeInTheDocument();
		expect(screen.getByText(SCANNER_ENRICH_STEP_CLONE)).toBeInTheDocument();
		expect(screen.getByText(SCANNER_ENRICH_STEP_ENRICH(4))).toBeInTheDocument();
		expect(screen.getByText(SCANNER_ENRICH_STEP_RECHECK("CSDK-101"))).toBeInTheDocument();
		expect(screen.getByText(SCANNER_ENRICH_STEP_DIFF)).toBeInTheDocument();
		expect(screen.getByText("main @ 826b268 · 2.1s")).toBeInTheDocument();
		expect(screen.getByText("enriching 1/1 findings (grouped by file)")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: CANCEL }));
		expect(onCancel).toHaveBeenCalled();
	});

	it("names the Trustabl default model when none was picked", () => {
		renderPanel(baseRun({ model: undefined }));
		expect(screen.getByText(SCANNER_ENRICH_RUNNING_TITLE(SCANNER_ENRICH_MODEL_DEFAULT))).toBeInTheDocument();
	});

	it("shows the diff for review with the re-check badge and actions", async () => {
		const { onDiscard, onRetry } = renderPanel(
			baseRun({
				status: "succeeded",
				explanation: "Removed Bash from the data-analyst tools.",
				diff: DIFF,
				additions: 1,
				deletions: 1,
				resolved: true,
				newFindings: 0,
				durationMs: 21000,
				steps: [
					{ key: "clone", status: "done" },
					{ key: "enrich", status: "done" },
					{ key: "recheck", status: "done", detail: "resolved" },
					{ key: "diff", status: "done" },
				],
			})
		);
		expect(screen.getByText(SCANNER_ENRICH_REVIEW_TITLE)).toBeInTheDocument();
		expect(screen.getByText(SCANNER_ENRICH_RESOLVED_BADGE("CSDK-101", 0))).toBeInTheDocument();
		expect(screen.getByText("CSDK-101 resolved · 0 new findings")).toBeInTheDocument();
		expect(screen.getByText("Removed Bash from the data-analyst tools.")).toBeInTheDocument();
		expect(screen.getByText("+1")).toBeInTheDocument();
		expect(screen.getByText("−1")).toBeInTheDocument();
		expect(screen.getByText(REMOVED, EXACT)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH_COPY_DIFF }));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(DIFF);
		await screen.findByRole("button", { name: SCANNER_ENRICH_COPY_DIFF });
		expect(mockToast.success).toHaveBeenCalledWith(SCANNER_ENRICH_DIFF_COPIED);

		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH_DISCARD }));
		expect(onDiscard).toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH_RETRY }));
		expect(onRetry).toHaveBeenCalled();
	});

	it("says when the fix was not re-checked", () => {
		renderPanel(baseRun({ status: "succeeded", recheck: false, diff: DIFF, additions: 1, deletions: 1 }));
		expect(screen.getByText(SCANNER_ENRICH_NOT_RECHECKED)).toBeInTheDocument();
	});

	it("explains a failed re-check with the log and the partial diff", () => {
		const { onRetry } = renderPanel(
			baseRun({
				status: "failed",
				failure: "still-detected",
				attempt: 2,
				error: SCANNER_ENRICH_STILL_DETECTED("CSDK-101", 2),
				explanation: "Reworded the description but left Bash in the tools list.",
				partialDiff: DIFF,
				steps: [
					{ key: "clone", status: "done" },
					{ key: "enrich", status: "done" },
					{ key: "recheck", status: "failed", detail: "still detected at agent/agent.py:4-9" },
					{ key: "diff", status: "skipped" },
				],
			})
		);
		expect(screen.getByText(SCANNER_ENRICH_FAILED_STILL_DETECTED("CSDK-101", 2))).toBeInTheDocument();
		expect(screen.getByText("Reworded the description but left Bash in the tools list.")).toBeInTheDocument();
		expect(screen.queryByText(SCANNER_ENRICH_STILL_DETECTED("CSDK-101", 2))).not.toBeInTheDocument();
		expect(screen.getByText("still detected at agent/agent.py:4-9")).toBeInTheDocument();
		expect(screen.queryByText("enriching 1/1 findings (grouped by file)")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH_VIEW_LOG }));
		expect(screen.getByText("enriching 1/1 findings (grouped by file)")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: SCANNER_ENRICH_HIDE_LOG })).toBeInTheDocument();
		expect(screen.queryByText(REMOVED, EXACT)).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH_VIEW_PARTIAL_DIFF }));
		expect(screen.getByText(REMOVED, EXACT)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH_RETRY }));
		expect(onRetry).toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: CANCEL })).not.toBeInTheDocument();
	});

	it("titles a provider failure and shows its message", () => {
		renderPanel(
			baseRun({
				status: "failed",
				failure: "provider",
				error: "claude api: 401 Unauthorized",
				steps: [
					{ key: "clone", status: "done" },
					{ key: "enrich", status: "failed" },
					{ key: "recheck", status: "skipped" },
					{ key: "diff", status: "skipped" },
				],
			})
		);
		expect(screen.getByText(SCANNER_ENRICH_FAILED_PROVIDER)).toBeInTheDocument();
		expect(screen.getByText("claude api: 401 Unauthorized")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: SCANNER_ENRICH_VIEW_PARTIAL_DIFF })).not.toBeInTheDocument();
	});

	it("shows a cancelled run with Retry and Discard", () => {
		const { onDiscard } = renderPanel(baseRun({ status: "cancelled", error: SCANNER_ENRICH_CANCELLED }));
		expect(screen.getByText(SCANNER_ENRICH_CANCELLED_TITLE)).toBeInTheDocument();
		expect(screen.getByText(SCANNER_ENRICH_CANCELLED)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: SCANNER_ENRICH_RETRY })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH_DISCARD }));
		expect(onDiscard).toHaveBeenCalled();
	});
});
