import { act, render } from "@testing-library/react";
import TraceDetailRequestSheet from "@/components/(playground)/observability/trace-detail-request-sheet";

const mockUpdateRequest = jest.fn();
let onSpanChange: (spanId: string, traceId?: string) => void;

jest.mock("next/navigation", () => ({
	useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/(playground)/request/request-context", () => ({
	useRequest: () => [
		{ spanId: "span-1", id: "trace-1", spanName: "first span" },
		mockUpdateRequest,
	],
	useRequestNavigation: () => ({ items: [], total: 0, offset: 0 }),
}));

jest.mock("@/components/(playground)/observability/trace-detail-page", () => ({
	TraceDetailView: (props: { onSpanChange: typeof onSpanChange }) => {
		onSpanChange = props.onSpanChange;
		return null;
	},
}));

jest.mock("@/components/ui/sheet", () => ({
	Sheet: ({ children }: any) => <div>{children}</div>,
	SheetContent: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/ui/resizeable-panel", () => ({
	ResizeablePanel: ({ children }: any) => <div>{children}</div>,
}));

describe("TraceDetailRequestSheet", () => {
	it("replaces the old trace id when the arrows move to another span", () => {
		render(<TraceDetailRequestSheet />);

		act(() => onSpanChange("span-2", "trace-2"));

		expect(mockUpdateRequest).toHaveBeenCalledWith(
			expect.objectContaining({ spanId: "span-2", id: "trace-2" })
		);
	});
});
