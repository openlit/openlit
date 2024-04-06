import { Tab } from "@headlessui/react";
import {
	DEFAULT_TIME_RANGE,
	TIME_RANGE_TYPE,
	useFilter,
} from "./filter-context";

const TIME_RANGE_TABS: { key: string; label: string }[] = Object.keys(
	TIME_RANGE_TYPE
).map((k: string) => ({
	key: k,
	label: TIME_RANGE_TYPE[k as keyof typeof TIME_RANGE_TYPE],
}));

const DEFAULT_CHECKED_INDEX = TIME_RANGE_TABS.findIndex(
	({ key }) => key === DEFAULT_TIME_RANGE
);

const Filter = () => {
	const [, updateFilter] = useFilter();
	const handleChange = (index: number) => {
		const selectedTab = TIME_RANGE_TABS[index].key;
		updateFilter("timeLimit.type", selectedTab);
	};

	return (
		<div className="flex pb-3 pt-2">
			<Tab.Group defaultIndex={DEFAULT_CHECKED_INDEX} onChange={handleChange}>
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
