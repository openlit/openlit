import { Tab, TabGroup, TabList } from "@tremor/react";
import {
	DEFAULT_TIME_RANGE,
	TIME_RANGE_TYPE,
	useFilter,
} from "../filter-context";

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
		<div className="flex mb-2 p-2">
			<TabGroup
				onIndexChange={handleChange}
				defaultIndex={DEFAULT_CHECKED_INDEX}
			>
				<TabList variant="solid">
					{TIME_RANGE_TABS.map(({ label, key }) => (
						<Tab key={key} value={key}>
							{label}
						</Tab>
					))}
				</TabList>
			</TabGroup>
		</div>
	);
};

export default Filter;
