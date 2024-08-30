import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { useEffect, useRef } from "react";
import { REFRESH_RATE_EVENT } from "@/utils/hooks/useRefreshRate";
import { REFRESH_RATE_TYPE, TIME_RANGE_TYPE } from "@/store/filter";

const REFRESH_RATE_TABS: { key: string; label: string }[] = Object.keys(
	REFRESH_RATE_TYPE
).map((k: string) => ({
	key: k,
	label: REFRESH_RATE_TYPE[k as keyof typeof REFRESH_RATE_TYPE],
}));

const RefreshRate = () => {
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const refreshRateTimer = useRef<NodeJS.Timeout>();
	const getRefreshTime = (key: string) => {
		let refreshTime = 0;
		switch (key) {
			case REFRESH_RATE_TYPE["30s"]:
				refreshTime = 30 * 1000;
				break;
			case REFRESH_RATE_TYPE["1m"]:
				refreshTime = 60 * 1000;
				break;
			case REFRESH_RATE_TYPE["5m"]:
				refreshTime = 5 * 60 * 1000;
				break;
			case REFRESH_RATE_TYPE["15m"]:
				refreshTime = 15 * 60 * 1000;
				break;
			default:
				refreshTime = 0;
				break;
		}

		return refreshTime;
	};

	const handleChange = (key: string) => {
		updateFilter("refreshRate", key);
	};

	useEffect(() => {
		const refreshTime = getRefreshTime(filter.refreshRate);
		if (refreshTime > 0) {
			refreshRateTimer.current = setInterval(() => {
				const refreshCustomEvent = new CustomEvent(REFRESH_RATE_EVENT);
				document.dispatchEvent(refreshCustomEvent);
			}, refreshTime);
		} else {
			clearInterval(refreshRateTimer.current);
			refreshRateTimer.current = undefined;
		}

		return () => {
			clearInterval(refreshRateTimer.current);
			refreshRateTimer.current = undefined;
		};
	}, [filter.refreshRate]);

	return (
		<Tabs defaultValue={filter.refreshRate} onValueChange={handleChange}>
			<TabsList>
				{REFRESH_RATE_TABS.map(({ label, key }) => (
					<TabsTrigger
						key={key}
						value={key}
						className={`${
							[REFRESH_RATE_TYPE["1m"], REFRESH_RATE_TYPE["5m"]].includes(key)
								? "data-[state=active]:bg-warning dark:data-[state=active]:bg-warning"
								: key === REFRESH_RATE_TYPE["30s"]
								? "data-[state=active]:bg-error dark:data-[state=active]:bg-error"
								: key === REFRESH_RATE_TYPE["15m"]
								? "data-[state=active]:bg-success dark:data-[state=active]:bg-success"
								: ""
						}`}
					>
						{label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	);
};

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
			<RefreshRate />
		</div>
	);
};

export default Filter;
