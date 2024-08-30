import { useEffect } from "react";

export const REFRESH_RATE_EVENT = "refresh-data";

export function useRefreshRate(fn: EventListener) {
	useEffect(() => {
		document.addEventListener(REFRESH_RATE_EVENT, fn);
		return () => {
			document.removeEventListener(REFRESH_RATE_EVENT, fn);
		};
	}, [fn]);
	return null;
}
