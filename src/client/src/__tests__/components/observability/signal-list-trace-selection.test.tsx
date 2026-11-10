import { act, render } from "@testing-library/react";
import ObservabilitySignalList from "@/components/(playground)/observability/signal-list";

type DetailProps = {
	onSpanChange: (spanId: string, traceId?: string) => void;
	onActiveSpanChange: (spanId: string) => void;
};

let detail: DetailProps;
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockFilter = { offset: 0, limit: 10, timeLimit: {}, selectedConfig: {} };

jest.mock("next/navigation", () => ({
	useRouter: () => mockRouter,
	usePathname: () => "/telemetry",
	useSearchParams: () =>
		new URLSearchParams("selected=span-1&traceId=trace-1"),
}));

jest.mock("@/store", () => ({
	useRootStore: (selector: (state: object) => unknown) => selector({}),
}));
jest.mock("@/selectors/filter", () => ({
	getFilterDetails: () => mockFilter,
	getUpdateAttributeKeys: () => jest.fn(),
	getUpdateConfig: () => jest.fn(),
	getUpdateFilter: () => jest.fn(),
}));
jest.mock("@/selectors/page", () => ({
	getVisibilityColumnsOfPage: () => ({}),
}));
jest.mock("@/selectors/database-config", () => ({
	getPingStatus: () => "pending",
}));
jest.mock("@/selectors/project", () => ({
	getCurrentProjectEnvironment: () => null,
}));
jest.mock("@/helpers/client/observability", () => ({
	prepareObservabilitySignalChange: jest.fn(),
}));
jest.mock("@/components/(playground)/agents/agent-scope-provider", () => ({
	useIsAgentScoped: () => false,
}));

jest.mock("@/components/(playground)/observability/trace-detail-page", () => ({
	TraceDetailView: (props: DetailProps) => {
		detail = props;
		return null;
	},
}));
jest.mock("@/components/(playground)/observability/metric-detail-page", () => ({
	MetricDetailView: () => null,
}));
jest.mock("@/components/(playground)/observability/log-detail-page", () => ({
	LogDetailView: () => null,
}));
jest.mock("@/components/(playground)/observability/signal-summary", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/observability/signal-records", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/observability/generation-health-bar", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/observability/agent-loop-bar", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/filter/traces-filter", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/request/group-breadcrumb", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/request/grouped-table", () => ({
	__esModule: true,
	default: () => null,
	buildGroupValueFilter: jest.fn(),
}));
jest.mock("@/components/ui/sheet", () => ({
	Sheet: ({ open, children }: any) => (open ? <div>{children}</div> : null),
	SheetContent: ({ children }: any) => <div>{children}</div>,
}));
jest.mock("@/components/ui/resizeable-panel", () => ({
	ResizeablePanel: ({ children }: any) => <div>{children}</div>,
}));

const config = { key: "traces", listUrl: "/api/telemetry/traces" } as any;

describe("ObservabilitySignalList trace selection", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		render(<ObservabilitySignalList config={config} />);
	});

	it("writes the next row's trace id to the URL when the arrows move spans", () => {
		act(() => detail.onSpanChange("span-2", "trace-2"));

		expect(mockRouter.replace).toHaveBeenLastCalledWith(
			"/telemetry?selected=span-2&traceId=trace-2",
			{ scroll: false }
		);
	});

	it("drops the old trace id when the next row has none", () => {
		act(() => detail.onSpanChange("span-2"));

		expect(mockRouter.replace).toHaveBeenLastCalledWith(
			"/telemetry?selected=span-2",
			{ scroll: false }
		);
	});

	it("keeps the current trace id for a span picked in the hierarchy tree", () => {
		act(() => detail.onActiveSpanChange("child-span"));

		expect(mockRouter.replace).toHaveBeenLastCalledWith(
			"/telemetry?selected=child-span&traceId=trace-1",
			{ scroll: false }
		);
	});
});
