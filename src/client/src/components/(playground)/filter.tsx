import { Tab } from "@headlessui/react";
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
	const handleChange = (index: number) => {
		const selectedTab = TIME_RANGE_TABS[index].key;
		updateFilter("timeLimit.type", selectedTab);
	};

	const DEFAULT_CHECKED_INDEX = TIME_RANGE_TABS.findIndex(
		({ key }) => key === (filter.timeLimit.type || DEFAULT_TIME_RANGE)
	);

	return (
		<div className="flex pb-3 pt-2">
			<Tab.Group selectedIndex={DEFAULT_CHECKED_INDEX} onChange={handleChange}>
				<Tab.List className="flex space-x-1 rounded-xl bg-secondary/[0.8] p-1">
					{TIME_RANGE_TABS.map(({ label, key }) => (
						<Tab
							key={key}
							className={({ selected }) =>
								`w-full rounded-lg px-2.5 py-1 text-sm ring-white/60 ring-offset-2 focus:outline-none ${
									selected
										? "bg-primary/[0.2] text-primary shadow ring-offset-primary"
										: "text-tertiary/[0.7] hover:bg-primary/[0.2] hover:text-primary/[0.7]"
								}`
							}
						>
							{label}
						</Tab>
					))}
				</Tab.List>
			</Tab.Group>
		</div>
	);
};

export default Filter;
