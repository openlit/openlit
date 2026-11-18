import { act, render } from "@testing-library/react";
import RefreshRate from "@/components/(playground)/filter/refresh-rate";
import { useRootStore } from "@/store";

jest.mock("next/navigation", () => ({
	usePathname: () => "/telemetry",
}));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const filter = () => useRootStore.getState().filter;
const timeLimit = () =>
	filter().details.timeLimit as { start: Date; end: Date; type: string };
const windowMs = () =>
	new Date(timeLimit().end).getTime() - new Date(timeLimit().start).getTime();
const refresh = () =>
	act(() => {
		document.dispatchEvent(new CustomEvent("refresh-rate"));
	});

describe("RefreshRate", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
		act(() => filter().updateFilter("timeLimit.type", "24H"));
	});
	afterEach(() => jest.useRealTimers());

	it("slides a relative window instead of growing it", () => {
		render(<RefreshRate />);
		const before = new Date(timeLimit().start).getTime();

		jest.advanceTimersByTime(HOUR);
		refresh();

		expect(windowMs()).toBe(DAY);
		expect(new Date(timeLimit().start).getTime()).toBe(before + HOUR);
	});

	it("moves both bounds in a single store update", () => {
		render(<RefreshRate />);
		jest.advanceTimersByTime(HOUR);
		const listener = jest.fn();
		const unsubscribe = useRootStore.subscribe(listener);

		refresh();
		unsubscribe();

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("uses the preset selected after mount", () => {
		render(<RefreshRate />);
		act(() => filter().updateFilter("timeLimit.type", "7D"));

		jest.advanceTimersByTime(HOUR);
		refresh();

		expect(windowMs()).toBe(7 * DAY);
	});

	it("leaves a custom range untouched", () => {
		const start = new Date("2026-07-01T00:00:00.000Z");
		const end = new Date("2026-07-02T00:00:00.000Z");
		act(() =>
			filter().updateFilter("timeLimit.type", "CUSTOM", { start, end })
		);
		render(<RefreshRate />);

		jest.advanceTimersByTime(HOUR);
		refresh();

		expect(timeLimit().start).toEqual(start);
		expect(timeLimit().end).toEqual(end);
	});
});
