import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { TIME_RANGE_TYPE } from "@/store/filter";

const TIME_RANGE_TABS: { key: string; label: string }[] = Object.keys(
	TIME_RANGE_TYPE
).map((k: string) => ({
	key: k,
	label: TIME_RANGE_TYPE[k as keyof typeof TIME_RANGE_TYPE],
}));

const Filter = ({ className = "" }: { className?: string }) => {
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);

	const handleChange = (key: string) => {
		updateFilter("timeLimit.type", key);
	};

	const onCustomDateChange = (start: Date, end: Date) => {
		updateFilter("timeLimit.type", TIME_RANGE_TYPE.CUSTOM, { start, end });
	};

	return (
		<div className={`flex grow gap-4 ${className}`}>
			<Tabs defaultValue={filter.timeLimit.type} onValueChange={handleChange}>
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
