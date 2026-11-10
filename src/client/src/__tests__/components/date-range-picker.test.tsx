import { fireEvent, render, screen } from "@testing-library/react";
import {
	DatePickerWithRange,
	mergeTimeRange,
} from "@/components/ui/date-range-picker";
import getMessage from "@/constants/messages";

const m = getMessage();

describe("mergeTimeRange", () => {
	const day = new Date(2026, 2, 10);

	it("makes a same-day range cover the whole day by default", () => {
		const { start, end } = mergeTimeRange(day, day, "00:00", "23:59");
		expect(start).toEqual(new Date(2026, 2, 10, 0, 0, 0, 0));
		expect(end).toEqual(new Date(2026, 2, 10, 23, 59, 59, 999));
	});

	it("applies the times to their own dates and replaces the existing time", () => {
		const { start, end } = mergeTimeRange(
			new Date(2026, 2, 10, 8, 15, 30),
			new Date(2026, 2, 12, 9, 45, 10),
			"10:30",
			"14:05"
		);
		expect(start).toEqual(new Date(2026, 2, 10, 10, 30, 0, 0));
		expect(end).toEqual(new Date(2026, 2, 12, 14, 5, 59, 999));
	});

	it("returns invalid dates for a cleared time field", () => {
		const { start, end } = mergeTimeRange(day, day, "", "");
		expect(Number.isNaN(start.getTime())).toBe(true);
		expect(Number.isNaN(end.getTime())).toBe(true);
	});
});

describe("DatePickerWithRange", () => {
	const selectedDate = {
		start: new Date(2026, 2, 10, 9, 0),
		end: new Date(2026, 2, 12, 17, 30),
	};

	const open = () => fireEvent.click(screen.getByRole("button"));
	const done = () => screen.getByRole("button", { name: "Done" });

	it("stays date-only unless showTime is set", () => {
		const onCustomDateChange = jest.fn();
		render(
			<DatePickerWithRange
				selectedDate={selectedDate}
				onCustomDateChange={onCustomDateChange}
			/>
		);
		expect(screen.getByRole("button")).toHaveTextContent(
			"Mar 10, 2026 - Mar 12, 2026"
		);
		open();
		expect(screen.queryByLabelText(m.DATE_RANGE_START_TIME)).toBeNull();
		fireEvent.click(done());
		expect(onCustomDateChange).toHaveBeenCalledWith(
			selectedDate.start,
			selectedDate.end
		);
	});

	it("shows the time and merges the edited fields into the range", () => {
		const onCustomDateChange = jest.fn();
		render(
			<DatePickerWithRange
				showTime
				selectedDate={selectedDate}
				onCustomDateChange={onCustomDateChange}
			/>
		);
		expect(screen.getByRole("button")).toHaveTextContent(
			"Mar 10, 2026 09:00 - Mar 12, 2026 17:30"
		);
		open();
		fireEvent.change(screen.getByLabelText(m.DATE_RANGE_START_TIME), {
			target: { value: "10:15" },
		});
		fireEvent.change(screen.getByLabelText(m.DATE_RANGE_END_TIME), {
			target: { value: "11:45" },
		});
		fireEvent.click(done());
		expect(onCustomDateChange).toHaveBeenCalledWith(
			new Date(2026, 2, 10, 10, 15, 0, 0),
			new Date(2026, 2, 12, 11, 45, 59, 999)
		);
	});

	it("defaults a newly picked day to the whole day", () => {
		const onCustomDateChange = jest.fn();
		render(
			<DatePickerWithRange
				showTime
				selectedDate={selectedDate}
				onCustomDateChange={onCustomDateChange}
			/>
		);
		open();
		const pickMarch12 = () =>
			fireEvent.click(screen.getAllByRole("gridcell", { name: "12" })[0]);
		pickMarch12();
		pickMarch12();
		expect(screen.getByLabelText(m.DATE_RANGE_START_TIME)).toHaveValue("00:00");
		expect(screen.getByLabelText(m.DATE_RANGE_END_TIME)).toHaveValue("23:59");
		fireEvent.click(done());
		expect(onCustomDateChange).toHaveBeenCalledWith(
			new Date(2026, 2, 12, 0, 0, 0, 0),
			new Date(2026, 2, 12, 23, 59, 59, 999)
		);
	});

	it("keeps an end time typed before the range is finished", () => {
		const onCustomDateChange = jest.fn();
		render(
			<DatePickerWithRange
				showTime
				selectedDate={selectedDate}
				onCustomDateChange={onCustomDateChange}
			/>
		);
		open();
		const pickMarch12 = () =>
			fireEvent.click(screen.getAllByRole("gridcell", { name: "12" })[0]);
		pickMarch12();
		fireEvent.change(screen.getByLabelText(m.DATE_RANGE_END_TIME), {
			target: { value: "09:50" },
		});
		pickMarch12();
		expect(screen.getByLabelText(m.DATE_RANGE_END_TIME)).toHaveValue("09:50");
	});

	it("keeps an end time typed before picking a different end day", () => {
		const onCustomDateChange = jest.fn();
		render(
			<DatePickerWithRange
				showTime
				selectedDate={selectedDate}
				onCustomDateChange={onCustomDateChange}
			/>
		);
		open();
		const pick = (day: string) =>
			fireEvent.click(screen.getAllByRole("gridcell", { name: day })[0]);
		// Clicking the current end day starts a new range from it.
		pick("12");
		fireEvent.change(screen.getByLabelText(m.DATE_RANGE_END_TIME), {
			target: { value: "09:50" },
		});
		pick("14");
		expect(screen.getByLabelText(m.DATE_RANGE_END_TIME)).toHaveValue("09:50");
		// Clicking the start day clears the range; the next click starts a new one.
		pick("12");
		pick("16");
		fireEvent.change(screen.getByLabelText(m.DATE_RANGE_END_TIME), {
			target: { value: "08:20" },
		});
		pick("18");
		expect(screen.getByLabelText(m.DATE_RANGE_END_TIME)).toHaveValue("08:20");
		fireEvent.click(done());
		expect(onCustomDateChange).toHaveBeenCalledWith(
			new Date(2026, 2, 16, 0, 0, 0, 0),
			new Date(2026, 2, 18, 8, 20, 59, 999)
		);
	});

	it("blocks a cleared field and an end before the start", () => {
		const sameDay = {
			start: new Date(2026, 2, 10, 9, 0),
			end: new Date(2026, 2, 10, 17, 30),
		};
		render(
			<DatePickerWithRange
				showTime
				selectedDate={sameDay}
				onCustomDateChange={jest.fn()}
			/>
		);
		open();
		const end = screen.getByLabelText(m.DATE_RANGE_END_TIME);
		expect(done()).toBeEnabled();
		fireEvent.change(end, { target: { value: "" } });
		expect(done()).toBeDisabled();
		fireEvent.change(end, { target: { value: "08:00" } });
		expect(done()).toBeDisabled();
	});
});
