import { fireEvent, render, screen } from "@testing-library/react";
import ScannerForgeParamsDialog from "@/components/(playground)/scanner/scanner-forge-params-dialog";
import type { ScannerForgeSchema } from "@/lib/platform/connectors/scanner/cli-schema";
import type { ScannerJob } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_FORGE_NO_PREFILL_NOTE,
	SCANNER_FORGE_RUN,
	RESET,
} from "@/constants/messages/en";

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
};
const SCHEMA: ScannerForgeSchema = {
	policies: ["claude_sdk", "openai_sdk", "mcp", "claude_skill"],
	flags: [
		{ flag: "rules-ref", key: "rulesRef", kind: "string", group: "rules", help: "pin rules" },
		{ flag: "offline", key: "offline", kind: "boolean", group: "scan", help: "use cache only" },
	],
};
const DEFAULTS = {
	target: TARGET,
	fileName: "SKILL.md",
	rulesRef: "",
	policies: ["claude_sdk", "mcp"],
	extras: {},
};

function renderDialog(over: Partial<Parameters<typeof ScannerForgeParamsDialog>[0]> = {}) {
	const onRun = jest.fn();
	const onClose = jest.fn();
	render(
		<ScannerForgeParamsDialog
			open
			defaults={DEFAULTS}
			prefill={{ job: JOB, policies: ["claude_sdk", "mcp"] }}
			schema={SCHEMA}
			onClose={onClose}
			onRun={onRun}
			{...over}
		/>
	);
	return { onRun, onClose };
}

function chip(name: string) {
	return screen.getByRole("button", { name });
}

function runButton() {
	return screen.getByRole("button", { name: SCANNER_FORGE_RUN });
}

describe("ScannerForgeParamsDialog", () => {
	it("prefills policies from the latest Analyzer scan", () => {
		renderDialog();
		expect(screen.getByText(/Prefilled from the latest Analyzer scan/)).toBeInTheDocument();
		expect(chip("claude_sdk")).toHaveAttribute("aria-pressed", "true");
		expect(chip("mcp")).toHaveAttribute("aria-pressed", "true");
		expect(chip("openai_sdk")).toHaveAttribute("aria-pressed", "false");
	});

	it("runs with the selected policies and the scan they came from", () => {
		const { onRun } = renderDialog();
		fireEvent.click(chip("mcp"));
		fireEvent.click(runButton());
		expect(onRun).toHaveBeenCalledWith({
			target: TARGET,
			policies: ["claude_sdk"],
			fileName: "SKILL.md",
			sourceJobId: "job:1",
		});
	});

	it("passes the rules ref and extra CLI flags", () => {
		const { onRun } = renderDialog();
		fireEvent.change(screen.getByLabelText("Rules ref"), { target: { value: "v1" } });
		fireEvent.click(screen.getByRole("switch", { name: "Offline" }));
		fireEvent.click(runButton());
		expect(onRun.mock.calls[0][0]).toMatchObject({ rulesRef: "v1", extras: { offline: true } });
	});

	it("disables Run without policies or a target", () => {
		renderDialog();
		fireEvent.click(chip("claude_sdk"));
		fireEvent.click(chip("mcp"));
		expect(runButton()).toBeDisabled();
		fireEvent.click(chip("mcp"));
		expect(runButton()).toBeEnabled();
		fireEvent.change(screen.getByLabelText("Repository URL"), { target: { value: " " } });
		expect(runButton()).toBeDisabled();
	});

	it("resets to the defaults", () => {
		renderDialog();
		fireEvent.click(chip("openai_sdk"));
		fireEvent.click(screen.getByRole("button", { name: RESET }));
		expect(chip("openai_sdk")).toHaveAttribute("aria-pressed", "false");
	});

	it("explains the manual path without an Analyzer scan", () => {
		const { onRun } = renderDialog({ prefill: undefined, defaults: { ...DEFAULTS, policies: [] } });
		expect(screen.getByText(SCANNER_FORGE_NO_PREFILL_NOTE)).toBeInTheDocument();
		fireEvent.click(chip("openai_sdk"));
		fireEvent.click(runButton());
		expect(onRun.mock.calls[0][0]).toEqual({
			target: TARGET,
			policies: ["openai_sdk"],
			fileName: "SKILL.md",
		});
	});

	it("falls back to the known policy list before the CLI schema loads", () => {
		renderDialog({ schema: undefined });
		expect(chip("crewai")).toBeInTheDocument();
		expect(screen.getByLabelText("Rules ref")).toBeInTheDocument();
	});
});
