import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";

const DEFAULT_TIME_RANGE = "24H";

const TIME_RANGE_TYPE: Record<"24H" | "7D" | "1M" | "3M", string> = {
	"24H": "24H",
	"7D": "7D",
	"1M": "1M",
	"3M": "3M",
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

	return (
		<Tabs
			defaultValue={DEFAULT_TIME_RANGE}
			className="w-[400px] mb-4 md:mb-4"
			onValueChange={handleChange}
		>
			<TabsList>
				{TIME_RANGE_TABS.map(({ label, key }) => (
					<TabsTrigger key={key} value={key}>
						{label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
};

export default Filter;
