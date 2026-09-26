/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VerifyIngestion, { sampleTraceCommand } from "@/components/(playground)/getting-started/verify-ingestion";

jest.mock("@/store", () => ({ useRootStore: (selector: any) => selector({ project: { currentEnvironment: "evaluation" } }), }));
jest.mock("@/utils/api", () => ({ getRequestHeaders: (headers: object) => headers }));
jest.mock("@/components/common/code-block", () => ({
	__esModule: true,
	default: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

beforeEach(() => {
	Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: (values: Uint8Array) => values.fill(1) }, configurable: true });
	global.fetch = jest.fn();
});

it("builds a fixed-ID OTLP sample with the selected environment and no key value", () => {
	const command = sampleTraceCommand("01010101010101010101010101010101", "evaluation");
	expect(command).toContain('"deployment.environment", "value": {"stringValue": "evaluation"}');
	expect(command).toContain('base64.b64encode(bytes.fromhex(trace_id)).decode()');
	expect(command).toContain('os.environ["OPENLIT_API_KEY"]');
	expect(command).not.toContain("Bearer test-secret");
});

it("only calls a trace stored when the lookup returns its exact ID, and links to its span", async () => {
	(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ record: undefined }) });
	(global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ record: { TraceId: "01010101010101010101010101010101", SpanId: "0102030405060708", Timestamp: "2026-09-26T00:00:00Z" } }) });
	render(<VerifyIngestion />);
	fireEvent.click(screen.getByRole("button", { name: "Verify stored trace" }));
	await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No stored trace found yet"));
	fireEvent.click(screen.getByRole("button", { name: "Verify stored trace" }));
	await waitFor(() => expect(screen.getByRole("link", { name: "Open the trace" })).toHaveAttribute("href", "/telemetry/traces/0102030405060708?traceId=01010101010101010101010101010101"));
	expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("environment=evaluation"), expect.objectContaining({ headers: { "x-openlit-environment": "evaluation" } }));
});

it("does not claim ingestion when the selected data source fails", async () => {
	(global.fetch as jest.Mock).mockResolvedValue({ ok: false });
	render(<VerifyIngestion />);
	fireEvent.click(screen.getByRole("button", { name: "Verify stored trace" }));
	await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not check"));
	expect(screen.queryByRole("link", { name: "Open the trace" })).not.toBeInTheDocument();
});
