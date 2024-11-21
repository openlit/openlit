import { getFilterDetails, getUpdateFilter } from "@/selectors/filter";
import { useRootStore } from "@/store";
import { useCallback, useEffect, useRef } from "react";
import { REFRESH_RATE_TYPE, getTimeLimitObject } from "@/store/filter";
import { usePathname } from "next/navigation";
import { TimerReset } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";

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
	const posthog = usePostHog();
	const filter = useRootStore(getFilterDetails);
	const updateFilter = useRootStore(getUpdateFilter);
	const refreshRateTimer = useRef<NodeJS.Timeout>();
	const pathname = usePathname();

	const handleChange = (key: string) => {
		updateFilter("refreshRate", key);
		posthog?.capture(CLIENT_EVENTS.REFRESH_RATE_CHANGE, {
			rate: key,
		});
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
		<div className="flex items-center mr-3">
			<Tooltip>
				<TooltipTrigger asChild>
					<TimerReset className="dark:text-white mr-3" />
				</TooltipTrigger>
				<TooltipContent side="bottom" sideOffset={5} className="w-64">
					Sets refresh rate. Low values may impact database performance.
				</TooltipContent>
			</Tooltip>
			<Select onValueChange={handleChange} value={filter.refreshRate}>
				<SelectTrigger
					id="model"
					className={`items-center [&_[data-description]]:hidden w-28 dark:text-white`}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{REFRESH_RATE_TABS.map(({ label, key }) => (
						<SelectItem key={key} value={key}>
							<div className={`flex items-start text-muted-foreground`}>
								<div className="grid">
									<span className="font-medium text-foreground">{label}</span>
								</div>
							</div>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
};

export default RefreshRate;
