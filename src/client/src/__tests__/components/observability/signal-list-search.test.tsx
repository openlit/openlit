import { act, fireEvent, render, screen } from "@testing-library/react";
import ObservabilitySignalList from "@/components/(playground)/observability/signal-list";
import { OBSERVABILITY_SIGNALS } from "@/components/(playground)/observability/registry";
import { OBSERVABILITY_SPAN_SEARCH_PLACEHOLDER } from "@/constants/messages/en";
import { useRootStore } from "@/store";

const mockFireRequest = jest.fn();

jest.mock("next/navigation", () => ({
	usePathname: () => "/telemetry",
	useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
	useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/utils/hooks/useFetchWrapper", () => ({
	__esModule: true,
	default: () => ({
		data: { records: [{ id: "1" }], total: 1 },
		fireRequest: mockFireRequest,
		reset: jest.fn(),
		isFetched: true,
		isLoading: false,
		error: null,
	}),
}));
jest.mock("@/utils/hooks/useSignalCapabilities", () => ({
	useSignalCapabilities: () => ({
		capabilities: { traces: { capabilities: { contentSearch: true } } },
	}),
}));
jest.mock("@/components/(playground)/observability/signal-summary", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/observability/signal-records", () => ({
	__esModule: true,
	default: () => <div data-testid="flat-list" />,
}));
jest.mock("@/components/(playground)/observability/generation-health-bar", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/observability/agent-loop-bar", () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock("@/components/(playground)/observability/trace-detail-page", () => ({
	TraceDetailView: () => null,
}));
jest.mock("@/components/(playground)/observability/metric-detail-page", () => ({
	MetricDetailView: () => null,
}));
jest.mock("@/components/(playground)/observability/log-detail-page", () => ({
	LogDetailView: () => null,
}));
jest.mock("@/components/(playground)/request/grouped-table", () => ({
	__esModule: true,
	...jest.requireActual("@/components/(playground)/request/grouped-table"),
	default: () => <div data-testid="grouped-table" />,
}));

const spans = OBSERVABILITY_SIGNALS.find(({ key }) => key === "spans")!;
const searchInput = () => screen.queryByLabelText(OBSERVABILITY_SPAN_SEARCH_PLACEHOLDER);
const lastListBody = () => {
	const [{ body }] = mockFireRequest.mock.calls
		.filter(([{ url }]) => url === spans.listUrl)
		.at(-1);
	return JSON.parse(body);
};

function search(term: string) {
	fireEvent.change(searchInput()!, { target: { value: term } });
	fireEvent.keyDown(searchInput()!, { key: "Enter" });
}

describe("ObservabilitySignalList search in a grouped drill-down", () => {
	beforeEach(() => {
		mockFireRequest.mockClear();
		window.localStorage.clear();
		const state = useRootStore.getState();
		state.filter.updateFilter("selectedConfig", {}, { clearFilter: true });
		state.databaseConfig.setPing({ status: "success" });

		render(<ObservabilitySignalList config={spans} />);
		act(() => {
			const { updateFilter } = useRootStore.getState().filter;
			updateFilter("groupBy", "model");
			updateFilter("groupValue", "gpt-4");
		});
	});

	it("stays on the drilled-in list and sends the term with the group filter", () => {
		search("refund");

		expect(screen.queryByTestId("grouped-table")).toBeNull();
		expect(screen.getByTestId("flat-list")).toBeInTheDocument();
		expect(searchInput()).toHaveValue("refund");
		const body = lastListBody();
		expect(body.groupValue).toBe("gpt-4");
		expect(body.selectedConfig.search).toBe("refund");
		expect(body.selectedConfig.customFilters).toEqual(
			expect.arrayContaining([expect.objectContaining({ value: "gpt-4" })])
		);
	});

	it("stays there when the search is cleared", () => {
		search("refund");
		search("");

		expect(screen.getByTestId("flat-list")).toBeInTheDocument();
		expect(searchInput()).toHaveValue("");
		const body = lastListBody();
		expect(body.groupValue).toBe("gpt-4");
		expect(body.selectedConfig.search).toBeFalsy();
	});
});
