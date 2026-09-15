import { fireEvent, render, screen } from "@testing-library/react";
import { StructuredQueryBuilder } from "@/components/(playground)/manage-dashboard/board-creator/components/structured-query-builder";
import {
	WIDGET_STRUCTURED_ADD_FILTER,
	WIDGET_STRUCTURED_FIELD_PLACEHOLDER,
	WIDGET_STRUCTURED_GROUP_BY_PLACEHOLDER,
	WIDGET_STRUCTURED_SORT_FIELD_PLACEHOLDER,
} from "@/constants/messages/en";

const fireRequest = jest.fn();

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

Object.defineProperty(global, "ResizeObserver", {
	writable: true,
	value: ResizeObserverMock,
});
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
	writable: true,
	value: jest.fn(),
});

jest.mock("@/utils/hooks/useFetchWrapper", () => ({
	__esModule: true,
	default: () => ({ fireRequest }),
}));

describe("StructuredQueryBuilder", () => {
	beforeEach(() => jest.clearAllMocks());

	it("keeps an incomplete filter as a UI draft when Add Filter is clicked", () => {
		const onChange = jest.fn();
		render(
			<StructuredQueryBuilder
				signals={["traces"]}
				value={{ mode: "timeseries", query: { signal: "traces" } }}
				onChange={onChange}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: WIDGET_STRUCTURED_ADD_FILTER })
		);

		expect(onChange).toHaveBeenCalledTimes(1);
		const next = onChange.mock.calls[0][0];
		expect(next.draftFilters).toEqual([
			{
				target: "attribute",
				scope: "span",
				key: "",
				op: "eq",
				value: "",
			},
		]);
		expect(next.query.filters).toBeUndefined();
	});

	it("uses a searchable rule-engine style combobox for the sort field", () => {
		const onChange = jest.fn();
		render(
			<StructuredQueryBuilder
				signals={["traces"]}
				value={{ mode: "timeseries", query: { signal: "traces" } }}
				onChange={onChange}
			/>
		);

		fireEvent.click(
			screen.getByRole("combobox", {
				name: WIDGET_STRUCTURED_SORT_FIELD_PLACEHOLDER,
			})
		);
		fireEvent.click(screen.getByRole("option", { name: "service.name" }));

		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.objectContaining({
					sort: [{ field: "service.name", direction: "asc" }],
				}),
			})
		);
	});

	it("uses the searchable combobox for group-by properties", () => {
		const onChange = jest.fn();
		render(
			<StructuredQueryBuilder
				signals={["traces"]}
				value={{ mode: "aggregate", query: { signal: "traces" } }}
				onChange={onChange}
			/>
		);

		fireEvent.click(
			screen.getByRole("combobox", {
				name: WIDGET_STRUCTURED_GROUP_BY_PLACEHOLDER,
			})
		);
		fireEvent.click(screen.getByRole("option", { name: "service.name" }));

		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.objectContaining({ groupBy: ["service.name"] }),
			})
		);
	});

	it("uses the searchable combobox for aggregation properties", () => {
		const onChange = jest.fn();
		render(
			<StructuredQueryBuilder
				signals={["traces"]}
				value={{
					mode: "aggregate",
					query: {
						signal: "traces",
						aggregations: [{ fn: "avg" }],
					},
				}}
				onChange={onChange}
			/>
		);

		fireEvent.click(
			screen.getByRole("combobox", {
				name: WIDGET_STRUCTURED_FIELD_PLACEHOLDER,
			})
		);
		fireEvent.click(
			screen.getByRole("option", { name: "gen_ai.request.model" })
		);

		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				query: expect.objectContaining({
					aggregations: [
						expect.objectContaining({
							fn: "avg",
							field: "gen_ai.request.model",
						}),
					],
				}),
			})
		);
	});
});
