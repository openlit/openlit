"use client";

import * as React from "react";
import { addDays, endOfMinute, format, isSameDay, parse } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import getMessage from "@/constants/messages";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

const TIME_FORMAT = "HH:mm";

// The end keeps its whole minute, so 23:59 means the end of the day and a
// range that starts and ends on the same minute is not empty.
export function mergeTimeRange(
	from: Date,
	to: Date,
	startTime: string,
	endTime: string
) {
	return {
		start: parse(startTime, TIME_FORMAT, from),
		end: endOfMinute(parse(endTime, TIME_FORMAT, to)),
	};
}

export function DatePickerWithRange({
	className,
	onCustomDateChange,
	selectedDate,
	maxRangeDays,
	showTime,
}: React.HTMLAttributes<HTMLDivElement> & {
	onCustomDateChange: (start: Date, end: Date) => void;
	selectedDate?: {
		start?: Date;
		end?: Date;
	};
	maxRangeDays?: number;
	showTime?: boolean;
}) {
	const m = getMessage();
	const [date, setDate] = React.useState<DateRange | undefined>({
		from: selectedDate?.start || addDays(new Date(), -15),
		to: selectedDate?.end || new Date(),
	});

	const [startTime, setStartTime] = React.useState(
		date?.from ? format(date.from, TIME_FORMAT) : ""
	);
	const [endTime, setEndTime] = React.useState(
		date?.to ? format(date.to, TIME_FORMAT) : ""
	);

	const onSelect = (range: DateRange | undefined) => {
		if (range?.from && !(date?.from && isSameDay(range.from, date.from))) {
			setStartTime("00:00");
		}
		if (range?.to && !(date?.to && isSameDay(range.to, date.to))) {
			setEndTime("23:59");
		}
		setDate(range);
	};

	const selectedRange =
		date?.from && date?.to
			? showTime
				? mergeTimeRange(date.from, date.to, startTime, endTime)
				: { start: date.from, end: date.to }
			: undefined;
	// A cleared time field gives invalid dates, which also fail this comparison.
	const canApply = !!selectedRange && selectedRange.start <= selectedRange.end;

	const formatDate = (value: Date, time: string) =>
		`${format(value, "LLL dd, y")}${showTime ? ` ${time}` : ""}`;

	const onCustomChange = () => {
		if (canApply) onCustomDateChange(selectedRange.start, selectedRange.end);
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					id="date"
					variant={"outline"}
					className={cn(
						"justify-start text-left font-normal dark:bg-stone-900 dark:text-stone-100 text-xs px-2 py-1 self-start h-full",
						!date && "text-muted-foreground",
						className
					)}
				>
					<CalendarIcon className="mr-2 h-3 w-3" />
					{date?.from ? (
						date.to ? (
							<>
								{formatDate(date.from, startTime)} -{" "}
								{formatDate(date.to, endTime)}
							</>
						) : (
							formatDate(date.from, startTime)
						)
					) : (
						<span>Pick a date</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar
					initialFocus
					mode="range"
					defaultMonth={date?.from}
					selected={date}
					onSelect={onSelect}
					max={maxRangeDays}
					numberOfMonths={2}
				/>
				{showTime && (
					<div className="flex items-center gap-4 px-3 pb-3 text-xs text-stone-500 dark:text-stone-400">
						<label className="flex flex-1 items-center gap-2 whitespace-nowrap">
							{m.DATE_RANGE_START_TIME}
							<Input
								type="time"
								className="h-7 px-2 py-1 text-xs dark:[color-scheme:dark]"
								value={startTime}
								onChange={(event) => setStartTime(event.target.value)}
							/>
						</label>
						<label className="flex flex-1 items-center gap-2 whitespace-nowrap">
							{m.DATE_RANGE_END_TIME}
							<Input
								type="time"
								className="h-7 px-2 py-1 text-xs dark:[color-scheme:dark]"
								value={endTime}
								onChange={(event) => setEndTime(event.target.value)}
							/>
						</label>
					</div>
				)}
				<div className="flex items-center justify-between gap-4 px-3 pb-3">
					{maxRangeDays ? (
						<p className="text-xs text-stone-500 dark:text-stone-400">
							{m.DATA_SOURCE_MAX_TIME_RANGE_HINT(maxRangeDays)}
						</p>
					) : (
						<span />
					)}
					<Button
						className="w-20"
						variant="default"
						size="xs"
						disabled={!canApply}
						onClick={onCustomChange}
					>
						Done
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
