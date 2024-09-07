import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { useCallback, useEffect, useRef } from "react";
import { REFRESH_RATE_TYPE, getTimeLimitObject } from "@/store/filter";
import { usePathname } from "next/navigation";
import { TimerReset } from "lucide-react";

const REFRESH_RATE_EVENT = "refresh-rate";

const PAGES_ENABLED_FOR_REFRESH_RATE = [
	"/dashboard",
	"/requests",
	"/exceptions",
];

const refreshTimes = {
	[REFRESH_RATE_TYPE["30s"]]: 30 * 1000,
	[REFRESH_RATE_TYPE["1m"]]: 60 * 1000,
	[REFRESH_RATE_TYPE["5m"]]: 5 * 60 * 1000,
	[REFRESH_RATE_TYPE["15m"]]: 15 * 60 * 1000,
};
const getRefreshTime = (key: keyof typeof REFRESH_RATE_TYPE) =>
	refreshTimes[key] || 0;

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
	const pathname = usePathname();

	const handleChange = (key: string) => {
		updateFilter("refreshRate", key);
	};

	const intervalCallback = useCallback(() => {
		const refreshCustomEvent = new CustomEvent(REFRESH_RATE_EVENT);
		document.dispatchEvent(refreshCustomEvent);
	}, []);

	useEffect(() => {
		const refreshTime = getRefreshTime(filter.refreshRate);
		if (refreshTime > 0) {
			refreshRateTimer.current = setInterval(intervalCallback, refreshTime);
		} else {
			clearInterval(refreshRateTimer.current);
			refreshRateTimer.current = undefined;
		}

		return () => {
			clearInterval(refreshRateTimer.current);
			refreshRateTimer.current = undefined;
		};
	}, [filter.refreshRate]);

	const updateEndTime = () => {
		const timeLimit = getTimeLimitObject(filter.timeLimit.type, "") as {
			end: Date;
		};
		updateFilter("timeLimit.end", timeLimit.end);
	};

	const isRefreshRateEnabled =
		PAGES_ENABLED_FOR_REFRESH_RATE.includes(pathname);

	useEffect(() => {
		if (isRefreshRateEnabled) {
			document.addEventListener(REFRESH_RATE_EVENT, updateEndTime);
		}
		return () => {
			document.removeEventListener(REFRESH_RATE_EVENT, updateEndTime);
		};
	}, [pathname]);

	if (!isRefreshRateEnabled) return null;

	return (
		<div className="flex items-center">
			<TimerReset className="dark:text-white mr-1" />
			<Tabs
				defaultValue={filter.refreshRate}
				onValueChange={handleChange}
				className="mr-6"
			>
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
		</div>
	);
};

export default RefreshRate;
