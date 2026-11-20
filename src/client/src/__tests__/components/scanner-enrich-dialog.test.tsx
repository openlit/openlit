import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ScannerEnrichDialog from "@/components/(playground)/scanner/scanner-enrich-dialog";
import type { ScannerFinding, ScannerJob } from "@/lib/platform/connectors/scanner/types";
import {
	SCANNER_ENRICH,
	SCANNER_ENRICH_ADD_KEY,
	SCANNER_ENRICH_COMMAND_PREVIEW,
	SCANNER_ENRICH_DIALOG_TITLE,
	SCANNER_ENRICH_KEY_FROM_VAULT,
	SCANNER_ENRICH_KEY_NOT_IN_VAULT,
	SCANNER_ENRICH_PROVIDERS_FAILED,
	SCANNER_ENRICH_SCOPE_ONLY,
	SCANNER_ENRICH_SCOPE_OTHERS,
	SCANNER_ENRICH_SCOPE_VALUE,
} from "@/constants/messages/en";

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
Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { writable: true, value: jest.fn() });

const bash: ScannerFinding = {
	id: "f4",
	ruleId: "CSDK-101",
	severity: "high",
	path: "agent/agent.py",
	line: 4,
	endLine: 9,
	title: "Claude subagent is granted the Bash tool",
};
const job: ScannerJob = {
	id: "job:1",
	status: "succeeded",
	target: "https://github.com/acme/agents",
	ref: "main",
	startedAt: "2026-11-12T00:00:00.000Z",
	findings: [
		{ id: "f1", ruleId: "META-005", severity: "info", title: "Rules skipped" },
		{ ...bash, id: "f2", line: 20 },
		{ id: "f3", ruleId: "CSDK-102", severity: "medium", title: "WebSearch" },
		bash,
		{ ...bash, id: "f5", line: 40 },
	],
};

const providers = [
	{ id: "anthropic", label: "Anthropic", envKey: "ANTHROPIC_API_KEY", hasKey: true, models: ["claude-sonnet-4-5", "claude-haiku-4-5"] },
	{ id: "openai", label: "OpenAI", envKey: "OPENAI_API_KEY", hasKey: false, models: ["gpt-4o"] },
	{ id: "google", label: "Google", envKey: "GOOGLE_API_KEY", hasKey: false, models: [] },
];

const fetchMock = jest.fn();

function renderDialog(overrides: Partial<{ job: ScannerJob; alertNumber: number }> = {}) {
	const onEnrich = jest.fn();
	const onClose = jest.fn();
	render(
		<ScannerEnrichDialog
			open
			connectorId="scanner:1"
			finding={bash}
			alertNumber={overrides.alertNumber ?? 4}
			job={overrides.job ?? job}
			onClose={onClose}
			onEnrich={onEnrich}
		/>
	);
	return { onEnrich, onClose };
}

function choose(trigger: HTMLElement, option: string) {
	fireEvent.keyDown(trigger, { key: "ArrowDown" });
	fireEvent.keyDown(screen.getByRole("option", { name: option }), { key: "Enter" });
}

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ ok: true, json: async () => ({ providers }) });
	global.fetch = fetchMock as unknown as typeof fetch;
});

describe("ScannerEnrichDialog", () => {
	it("loads providers for the connector and shows the Vault key status", async () => {
		renderDialog();
		expect(screen.getByText(SCANNER_ENRICH_DIALOG_TITLE)).toBeInTheDocument();
		expect(await screen.findByText(SCANNER_ENRICH_KEY_FROM_VAULT("ANTHROPIC_API_KEY"))).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/scanners/scanner%3A1/enrich/providers",
			expect.objectContaining({ headers: expect.objectContaining({ "x-test": "1" }) })
		);
		expect(screen.getByRole("button", { name: SCANNER_ENRICH })).toBeEnabled();
		expect(screen.getByText(SCANNER_ENRICH_COMMAND_PREVIEW(4))).toBeInTheDocument();
	});

	it("disables Enrich and links to Vault when the provider has no key", async () => {
		renderDialog();
		await screen.findByText(SCANNER_ENRICH_KEY_FROM_VAULT("ANTHROPIC_API_KEY"));
		choose(screen.getByRole("combobox", { name: "Provider" }), "OpenAI");
		expect(await screen.findByText(SCANNER_ENRICH_KEY_NOT_IN_VAULT("OPENAI_API_KEY"))).toBeInTheDocument();
		expect(screen.getByRole("link", { name: SCANNER_ENRICH_ADD_KEY })).toHaveAttribute("href", "/vault");
		expect(screen.getByRole("button", { name: SCANNER_ENRICH })).toBeDisabled();
	});

	it("lists the other findings of the same rule in the scope line", async () => {
		renderDialog();
		expect(screen.getByDisplayValue(SCANNER_ENRICH_SCOPE_VALUE(4))).toBeInTheDocument();
		expect(screen.getByText(SCANNER_ENRICH_SCOPE_OTHERS("CSDK-101", "#2, #5"))).toBeInTheDocument();
		await screen.findByText(SCANNER_ENRICH_KEY_FROM_VAULT("ANTHROPIC_API_KEY"));
	});

	it("says when the finding is the only one of its rule", async () => {
		renderDialog({ job: { ...job, findings: [job.findings![0], bash] }, alertNumber: 2 });
		expect(screen.getByText(SCANNER_ENRICH_SCOPE_ONLY("CSDK-101"))).toBeInTheDocument();
		await screen.findByText(SCANNER_ENRICH_KEY_FROM_VAULT("ANTHROPIC_API_KEY"));
	});

	it("sends the selected parameters", async () => {
		const { onEnrich } = renderDialog();
		await screen.findByText(SCANNER_ENRICH_KEY_FROM_VAULT("ANTHROPIC_API_KEY"));
		expect(screen.getByLabelText("Base branch")).toHaveValue("main");
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH }));
		expect(onEnrich).toHaveBeenCalledWith({
			provider: "anthropic",
			model: undefined,
			attempts: 1,
			recheck: true,
			baseRef: "main",
		});
	});

	it("sends a chosen model, two attempts and no re-check", async () => {
		const { onEnrich } = renderDialog();
		await screen.findByText(SCANNER_ENRICH_KEY_FROM_VAULT("ANTHROPIC_API_KEY"));
		choose(screen.getByRole("combobox", { name: "Model" }), "claude-haiku-4-5");
		choose(screen.getByRole("combobox", { name: "Attempts" }), "Up to 2 attempts");
		fireEvent.click(screen.getByRole("switch", { name: "Re-check rule after enrich" }));
		fireEvent.change(screen.getByLabelText("Base branch"), { target: { value: " develop " } });
		fireEvent.click(screen.getByRole("button", { name: SCANNER_ENRICH }));
		expect(onEnrich).toHaveBeenCalledWith({
			provider: "anthropic",
			model: "claude-haiku-4-5",
			attempts: 2,
			recheck: false,
			baseRef: "develop",
		});
	});

	it("keeps Enrich disabled when providers cannot be loaded", async () => {
		fetchMock.mockResolvedValue({ ok: false, json: async () => ({ err: "nope" }) });
		renderDialog();
		expect(await screen.findByText(SCANNER_ENRICH_PROVIDERS_FAILED)).toBeInTheDocument();
		await waitFor(() => expect(screen.getByRole("button", { name: SCANNER_ENRICH })).toBeDisabled());
	});
});
