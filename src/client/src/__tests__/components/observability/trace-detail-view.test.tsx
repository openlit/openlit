import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TraceDetailView } from "@/components/(playground)/observability/trace-detail-page";
import getMessage from "@/constants/messages";
import { getData } from "@/utils/api";

const SPANS: Record<string, { traceId: string; name: string }> = {
	"span-1": { traceId: "trace-1", name: "first span" },
	"span-2": { traceId: "trace-2", name: "second span" },
	"span-3": { traceId: "trace-3", name: "third span" },
};
const PAIR_ERROR = "Span not found in the selected trace and telemetry source";

let mockSearchParams = new URLSearchParams();
const mockRouter = { push: jest.fn(), replace: jest.fn() };

jest.mock("next/navigation", () => ({
	useRouter: () => mockRouter,
	useSearchParams: () => mockSearchParams,
}));

jest.mock("@/utils/api", () => ({
	...jest.requireActual("@/utils/api"),
	getData: jest.fn(),
}));

jest.mock("@/utils/hooks/useBreadcrumbs", () => ({
	useCustomBreadcrumbs: jest.fn(),
}));

jest.mock("@/store", () => ({ useRootStore: jest.fn() }));

jest.mock(
	"@/components/(playground)/observability/span-hierarchy-explorer",
	() => ({
		__esModule: true,
		default: ({ traceId }: { traceId?: string }) => (
			<div data-testid="hierarchy">{traceId}</div>
		),
	})
);
jest.mock("@/components/(playground)/observability/detail-object-tabs", () => ({
	__esModule: true,
	default: () => null,
	buildObjectTabs: () => [],
}));
jest.mock("@/components/(playground)/request/components/evaluations", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock(
	"@/components/(playground)/request/components/trace-ai-analysis-panel",
	() => ({ __esModule: true, default: () => null })
);
jest.mock("@/components/(playground)/scanner/scanner-session-findings", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/ui/resizable", () => ({
	ResizablePanelGroup: ({ children }: any) => <div>{children}</div>,
	ResizablePanel: ({ children }: any) => <div>{children}</div>,
	ResizableHandle: () => null,
}));

const mockGetData = getData as jest.MockedFunction<typeof getData>;
const rows = Object.entries(SPANS).map(([spanId, span]) => ({
	spanId,
	id: span.traceId,
}));

const spanRequests = () =>
	mockGetData.mock.calls
		.map(([args]) => args.url as string)
		.filter((url) => url.startsWith("/api/telemetry/request/span/"));

/** Mirrors read.ts: a mismatched span/trace pair is a 200 `{ err }`. */
function answerLikeTheServer() {
	mockGetData.mockImplementation(async ({ url }) => {
		const parsed = new URL(url, "http://localhost");
		if (!parsed.pathname.startsWith("/api/telemetry/request/span/")) {
			return { records: [], total: 0 };
		}
		const spanId = parsed.pathname.split("/").pop() as string;
		const span = SPANS[spanId];
		if (span.traceId !== parsed.searchParams.get("traceId")) {
			return { err: PAIR_ERROR };
		}
		return {
			err: null,
			record: { SpanId: spanId, TraceId: span.traceId, SpanName: span.name },
		};
	});
}

async function renderSheet(onSpanChange = jest.fn()) {
	mockSearchParams = new URLSearchParams("selected=span-1&traceId=trace-1");
	const view = (spanId: string) => (
		<TraceDetailView
			spanId={spanId}
			type="traces"
			variant="sheet"
			onSpanChange={onSpanChange}
			navigationRows={rows}
			navigationOffset={0}
			navigationTotal={rows.length}
		/>
	);
	const result = render(view("span-1"));
	await screen.findByRole("heading", { name: "first span" });
	return { ...result, view, onSpanChange };
}

const nextSpanButton = () => screen.getByTitle(getMessage().OBSERVABILITY_NEXT_SPAN);

describe("TraceDetailView arrow navigation", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		answerLikeTheServer();
	});

	it("fetches the next row with its own trace id while the URL is still stale", async () => {
		const { onSpanChange } = await renderSheet();

		fireEvent.click(nextSpanButton());

		await screen.findByRole("heading", { name: "second span" });
		expect(spanRequests()).toEqual([
			"/api/telemetry/request/span/span-1?traceId=trace-1",
			"/api/telemetry/request/span/span-2?traceId=trace-2",
		]);
		expect(onSpanChange).toHaveBeenCalledWith("span-2", "trace-2");
		expect(screen.getByTestId("hierarchy")).toHaveTextContent("trace-2");
	});

	it("uses the URL trace again when a different span is opened from the list", async () => {
		const { rerender, view } = await renderSheet();

		fireEvent.click(nextSpanButton());
		await screen.findByRole("heading", { name: "second span" });

		mockSearchParams = new URLSearchParams("selected=span-3&traceId=trace-3");
		rerender(view("span-3"));

		await screen.findByRole("heading", { name: "third span" });
		expect(spanRequests()).toContain(
			"/api/telemetry/request/span/span-3?traceId=trace-3"
		);
	});

	it("shows the fetch error instead of the previous span's content", async () => {
		await renderSheet();
		mockGetData.mockImplementationOnce(async () => ({ err: PAIR_ERROR }));

		fireEvent.click(nextSpanButton());

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent(getMessage().OBSERVABILITY_SPAN_LOAD_FAILED);
		expect(alert).toHaveTextContent(PAIR_ERROR);
		await waitFor(() =>
			expect(
				screen.queryByRole("heading", { name: "first span" })
			).not.toBeInTheDocument()
		);
		expect(screen.queryByTestId("hierarchy")).not.toBeInTheDocument();
	});

	it("recovers from a failed span when moving on to the next one", async () => {
		await renderSheet();
		mockGetData.mockImplementationOnce(async () => ({ err: PAIR_ERROR }));

		fireEvent.click(nextSpanButton());
		await screen.findByRole("alert");
		await act(async () => {
			fireEvent.click(nextSpanButton());
		});

		await screen.findByRole("heading", { name: "third span" });
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});
});
