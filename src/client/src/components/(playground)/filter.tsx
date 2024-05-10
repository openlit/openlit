import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";

const DEFAULT_TIME_RANGE = "24H";

const TIME_RANGE_TYPE: Record<"24H" | "7D" | "1M" | "3M" | "CUSTOM", string> = {
	"24H": "24H",
	"7D": "7D",
	"1M": "1M",
	"3M": "3M",
	CUSTOM: "CUSTOM",
};

const TIME_RANGE_TABS: { key: string; label: string }[] = Object.keys(
	TIME_RANGE_TYPE
).map((k: string) => ({
	key: k,
	label: TIME_RANGE_TYPE[k as keyof typeof TIME_RANGE_TYPE],
}));

const Filter = () => {
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const handleChange = (key: string) => {
		updateFilter("timeLimit.type", key);
	};

	const onCustomDateChange = (start: Date, end: Date) => {
		updateFilter("timeLimit.type", TIME_RANGE_TYPE.CUSTOM, { start, end });
	};

	return (
		<div className="flex w-full mb-4 md:mb-4 gap-4">
			<Tabs defaultValue={DEFAULT_TIME_RANGE} onValueChange={handleChange}>
				<TabsList>
					{TIME_RANGE_TABS.map(({ label, key }) => (
						<TabsTrigger key={key} value={key}>
							{label}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
			{filter.timeLimit.type === "CUSTOM" && (
				<DatePickerWithRange
					selectedDate={filter.timeLimit}
					onCustomDateChange={onCustomDateChange}
				/>
			)}
		</div>
	);
};

export default Filter;
